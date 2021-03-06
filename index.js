'use strict';

const async = require('async');
const Primus = require('primus');

const Path = require('path');
const Hapi = require('hapi');
const Inert = require('inert');
const generateId = require('shortid').generate;

const Datastore = require('nedb')

const userDB = new Datastore({ filename: './db/user', autoload: true });
const gameDB = new Datastore({ filename: './db/game', autoload: true });

const DB = {
    user: userDB,
    game: gameDB
};

const app = function(DB) {
    return {
        with: function(spark) {
            return {
                on: function(eventName) {
                    const steps= [];

                    const api = {
                        findUser: function(selector, fn) {
                            steps.push({
                                action: 'findUser',
                                selector: selector,
                                fn: fn
                            })

                            return api;
                        },
                        findGame: function(selector, fn) {
                            steps.push({
                                action: 'findGame',
                                selector: selector,
                                fn: fn
                            })

                            return api;
                        },
                        sendEvent: function(fn) {
                            steps.push({
                                action: 'sendEvent',
                                fn: fn
                            })

                            return api;
                        },
                        end: function() {
                            console.log('this is the end');

                            const context = {

                            };

                            async.mapSeries(
                                steps,
                                function(step, cb) {
                                    if (step.action == 'findUser') {
                                        DB.user.findOne(step.selector.apply(context), function (err, doc) {
                                            step.fn.apply(context, [doc]);
                                            cb();
                                        });
                                    }
                                    else if (step.action == 'findGame') {
                                        DB.game.findOne(step.selector.apply(context), function (err, doc) {
                                            step.fn.apply(context, [doc]);
                                            cb();
                                        });
                                    }
                                    else if (step.action == 'sendEvent') {
                                        step.fn.call(context, function(event, data) {
                                            console.log('there we go lad', event, data);
                                            spark.emit(event, data)
                                        });
                                        cb();
                                    }
                                    else {
                                        cb();
                                    }
                                },
                                function() {
                                    console.log('chain executed');
                                }
                            );

                            // run async stuff after another
                        }
                    }

                    return api;
                }
            }
        }
    }
};

const server = new Hapi.Server({
    connections: {
        routes: {
            files: {
                relativeTo: Path.join(__dirname)
            }
        }
    }
});

server.connection({ port: 3000 });

server.register(Inert, () => {});

server.route({
  method: 'GET',
  path: '/js/store.js',
  handler: {
    file: './node_modules/store/dist/store.legacy.min.js'
  }
})

server.route({
    method: 'GET',
    path: '/{param*}',
    handler: {
        directory: {
            path: './public',
            redirectToSlash: true,
            index: true
        }
    }
});

const games = {
    game1: {
        minPlayers: 2,
        maxPlayers: 2,
        logic: function(game, playerId, action) {
        }
    },
    game2: {
        minPlayers: 1,
        maxPlayers: 1,
        logic: function(game, playerId, action) {
            if (!game.messages) {
                game.messages = [];
            }

            if (action == 'dice') {
                game.messages.push(playerId + ' rolled the dice ');
            }

            return game;
        }
    }
};

const primus = new Primus(server.listener);
primus.plugin('emit', require('primus-emit'));

primus.on('connection', function (spark) {
    spark.on('requestUserId', function () {
        const userId = generateId();

        userDB.insert({userId: userId}, function (err, newDoc) {
            spark.emit('newUserId', userId);
        });
    });
    spark.on('createGame', function (type) {
        if (!spark.user) {
            return;
        }

        if (!games[type]) {
            return;
        }

        gameDB.findOne({ userId: spark.user.userId }, function (err, doc) {
            if (doc) {
                return spark.emit('alreadyInGame');
            }

            const joinToken = generateId();

            gameDB.insert({userId: spark.user.userId, type: type, running: false, maxPlayers: games[type].maxPlayers, minPlayers: games[type].minPlayers, joinToken: joinToken, players: [spark.user.userId] }, function (err, newDoc) {
                spark.emit('updateGame', newDoc);
            });
        });
    });
    spark.on('joinGame', function (token) {
        // check if not allready in a game!
        if (!spark.user) {
            return;
        }

        gameDB.findOne({ joinToken: token }, function (err, doc) {
            if (doc) {
                if (!doc || doc.running == true) {
                    return;
                }

                if (doc.players.indexOf(spark.user.userId) < 0) {
                    gameDB.update({ joinToken: token }, { $push: { players: spark.user.userId } }, {}, function (err, changes) {
                        gameDB.findOne({ joinToken: token }, function (err, doc) {
                            const players = doc.players;

                            primus.forEach(function(spark) {
                                if (!spark.user) return;

                                if (players.indexOf(spark.user.userId) > -1) {
                                    spark.emit('updateGame', doc);
                                }
                            });
                        });
                    });
                }
            }
        });
    });

    spark.on('startGame', function () {
        if (!spark.user) {
            return;
        }

        gameDB.findOne({ userId: spark.user.userId }, function (err, doc) {
            if (!doc || doc.running == true) {
                return;
            }

            const players = doc.players;

            gameDB.update({ userId: spark.user.userId }, { $set: { running: true, currentPlayer: 0 } }, {}, function (err, doc) {
                gameDB.findOne({ userId: spark.user.userId }, function (err, doc) {
                    if (doc) {
                        primus.forEach(function(spark) {
                            if (!spark.user) return;

                            if (players.indexOf(spark.user.userId) > -1) {
                                spark.emit('updateGame', doc);
                            }
                        });
                    }
                });
            });
        });
    });

    spark.on('closeGame', function () {
        if (!spark.user) {
            return;
        }

        gameDB.findOne({ userId: spark.user.userId }, function (err, doc) {
            if (!doc) {
                return;
            }

            const players = doc.players;

            gameDB.remove({userId: spark.user.userId }, function (err) {
                primus.forEach(function(spark) {
                    if (!spark.user) return;

                    if (players.indexOf(spark.user.userId) > -1) {
                        spark.emit('updateGame', null);
                    }
                });
            });
        });
    });

    spark.on('login', function (userId) {
        app(DB)
            .with(spark)
            .on('login')
            .findUser(
                function() {
                    return {userId: userId};
                },
                function(user) {
                    this.user = user;
                }
            )
            .findGame(
                function() {
                    if (!this.user) {
                        return;
                    }

                    return {userId: this.user.userId};
                },
                function(game) {
                    this.game = game;
                }
            )
            .sendEvent(function(send) {
                if (!this.user) {
                    return send('wrongUserId');
                }

                send('loggedIn', this.user);
            })
            .sendEvent(function(send) {
                if (this.game) {
                    send('updateGame', this.game);
                }
            })
            .end()
    });
    spark.on('action', function (gameId, action) {
        if (!spark.user) {
            return;
        }

        gameDB.findOne({ _id: gameId }, function (err, doc) {
            if (!doc) {
                return;
            }

            const playerIndex = doc.players.indexOf(spark.user.userId);

            if (playerIndex != doc.currentPlayer) {
                return;
            }

            if (!games[doc.type]) {
                return;
            }

            doc = games[doc.type].logic(doc, spark.user.userId, action);

            gameDB.update({ _id: gameId }, doc, {}, function (err, doc) {
                gameDB.findOne({ _id: gameId }, function (err, doc) {
                    if (doc) {
                        return spark.emit('updateGame', doc);
                    }
                });
            });
        });
    });
});

server.start((err) => {

    if (err) {
        throw err;
    }

    console.log('Server running at:', server.info.uri);

    setInterval(function() {
        let users = 0;
        let guests = 0;

        primus.forEach(function(spark) {
            if (spark.user) {
                users++;
            } else {
                guests++;
            }
        });

        console.log('connected guests:', guests);
        console.log('connected users:', users);
    }, 10000);
});
