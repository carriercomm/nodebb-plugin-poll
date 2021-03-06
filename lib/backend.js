var NodeBB = require('./nodebb'),
	db = NodeBB.db,

	async = require('async');

//To whoever reads this
//Please help improve
var Backend = {
	addPoll: function(pollData, callback) {
		db.incrObjectField('global', 'nextPollid', function(err, pollid) {
			if (err) {
				return callback(err, -1);
			}

			var pollOptions = pollData.options,
				pollSettings = pollData.settings;

			pollData.options = undefined;
			pollData.settings = undefined;
			pollData.pollid = pollid;

			var poll = {};
			for (var p in pollData) {
				if (pollData.hasOwnProperty(p) && pollData[p] !== undefined) {
					poll[p] = pollData[p];
				}
			}

			for(var i = 0, l = pollOptions.length; i < l; i++) {
				db.setObject('poll:' + pollid + ':options:' + i, pollOptions[i]);
				db.setAdd('poll:' + pollid + ':options', i);
			}

			db.setObject('poll:' + pollid, poll);
			db.setObject('poll:' + pollid + ':settings', pollSettings);
			db.listAppend('polls', pollid);

			db.setObjectField('topic:' + poll.tid, 'poll:id', pollid);
			return callback(null, pollid);
		});
	},
	getPoll: function(data, callback) {
		var pollid = data.pollid,
			uid = data.uid || false,
			withVotes = !!data.withVotes;
		async.parallel([function(next) {
			Backend.getPollInfo(pollid, next);
		}, function(next) {
			Backend.getPollOptions(pollid, withVotes, next);
		}, function(next) {
			Backend.getPollSettings(pollid, next);
		}, function(next) {
			if (uid) {
				Backend.hasUidVoted(uid, pollid, next);
			} else {
				next(null, false);
			}
		}], function(err, results) {
			results[0].options = results[1];
			results[0].settings = results[2];
			results[0].hasvoted = results[3];
			callback(null, results[0]);
		});
	},
	getPollByTid: function(tid, callback) {
		db.getObjectField('topic:' + tid, 'poll:id', function(err, result) {
			if (err) {
				return callback(err);
			}
			Backend.getPoll({ pollid: result, uid: 0 }, callback);
		});
	},
	getPollByPid: function(pid, callback) {
		db.getObjectField('post:' + pid, 'poll:id', function(err, result) {
			if (err) {
				return callback(err);
			}
			Backend.getPoll({ pollid: result, uid: 0 }, callback);
		});
	},
	getPollInfo: function(pollid, callback) {
		db.getObject('poll:' + pollid, callback);
	},
	getPollOptions: function(pollid, withVotes, callback) {
		if (typeof withVotes === 'function') {
			callback = withVotes;
			withVotes = false;
		}

		function getOption(option, next) {
			async.parallel([function(next) {
				db.getObject('poll:' + pollid + ':options:' + option, next);
			}, function(next) {
				if (withVotes) {
					db.getSetMembers('poll:' + pollid + ':options:' + option + ':votes', next);
				} else {
					next();
				}
			}], function(err, results) {
				if (results[1]) {
					results[0].votes = results[1];
				}
				next(null, results[0]);
			});
		}

		db.getSetMembers('poll:' + pollid + ':options', function(err, options) {
			async.map(options, getOption, callback);
		});
	},
	getPollSettings: function(pollid, callback) {
		db.getObject('poll:' + pollid + ':settings', callback);
	},
	pollHasOption: function(pollid, option, callback) {
		db.isSetMember('poll:' + pollid + ':options', option, callback);
	},
	pollHasOptions: function(pollid, options, callback) {
		db.isSetMembers('poll:' + pollid + ':options', options, callback);
	},
	changePid: function(pollid, pid, callback) {
		async.parallel([function(next) {
			Backend.setPollField(pollid, 'pid', pid, next);
		}, function(next) {
			db.setObjectField('post:' + pid, 'poll:id', pollid, next);
		}], callback);
	},
	changeTid: function(pollid, tid, callback) {
		async.parallel([function(next) {
			Backend.setPollField(pollid, 'tid', tid, next);
		}, function(next) {
			db.setObjectField('topic:' + tid, 'poll:id', pollid, next);
		}], callback);
	},
	setPollField: function(pollid, field, value, callback) {
		db.setObjectField('poll:' + pollid, field, value, callback);
	},
	setPollFields: function(pollid, fields, values, callback) {
		db.setObjectFields('poll:' + pollid, fields, values, callback);
	},
	getPollField: function(pollid, field, callback) {
		db.getObjectField('poll:' + pollid, field, callback);
	},
	getPollFields: function(pollid, fields, callback) {
		db.getObjectFields('poll:' + pollid, fields, callback);
	},
	/***************************
	 * Vote methods start here *
	 ***************************/
	addVote: function(voteData, callback) {
		var pollid = voteData.pollid,
			options = voteData.options,
			uid = voteData.uid;

		async.parallel([function(next) {
			async.each(options, function(option, cb) {
				//Increase option vote count
				db.incrObjectField('poll:' + pollid + ':options:' + option, 'votecount');
				//Add uid to list of votes
				db.setAdd('poll:' + pollid + ':options:' + option + ':votes', uid, cb);
			}, next);
		}, function(next) {
			//Add uid to poll voters
			db.setAdd('poll:' + pollid + ':voters', uid);
			//Increase poll vote count
			db.incrObjectFieldBy('poll:' + pollid, 'votecount', options.length, next);
		}, function(next) {
			//Get poll options for callback
			Backend.getPollOptions(pollid, next);
		}], function(err, results) {
			callback(err, {
				pollid: pollid,
				votecount: results[1],
				options: results[2]
			});
		});
	},
	//There has to be a way to make this more efficient
	removeVote: function(voteData, callback) {
		var pollid = voteData.pollid,
			options = voteData.options,
			uid = voteData.uid;
		async.parallel([function(next) {
			async.each(options, function(option, cb) {
				//Decrease option vote count
				db.decrObjectField('poll:' + pollid + ':options:' + option, 'votecount');
				//Remove uid from list of votes
				db.setRemove('poll:' + pollid + ':options:' + option + ':votes', uid, cb);
			}, next);
		}, function(next) {
			//Remove uid from poll voters
			db.setRemove('poll:' + pollid + ':voters', uid);
			//Decrease poll vote count
			db.decrObjectFieldBy('poll:' + pollid, 'votecount', options.length, next);
		}, function(next) {
			//Get poll options for callback
			Backend.getPollOptions(pollid, next);
		}], function(err, results) {
			callback(err, {
				pollid: pollid,
				votecount: results[1],
				options: results[2]
			});
		});
	},
	hasUidVoted: function(uid, pollid, callback) {
		db.isSetMember('poll:' + pollid + ':voters', uid, callback);
	},
	hasUidVotedOnOption: function(uid, pollid, option, callback) {
		db.isSetMember('poll:' + pollid + ':options:' + option + ':votes', uid, callback);
	}
}

module.exports = Backend;