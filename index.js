'use strict';

const Primus = require('primus');

const Path = require('path');
const Hapi = require('hapi');
const Inert = require('inert');
const generateId = require('shortid').generate;

const Datastore = require('nedb')
const userDB = new Datastore({ filename: './db/user', autoload: true });
const gameDB = new Datastore({ filename: './db/game', autoload: true });

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

const primus = new Primus(server.listener);
primus.plugin('emit', require('primus-emit'));

primus.on('connection', function (spark) {
    spark.on('requestUserId', function () {
        const userId = generateId();

        userDB.insert({userId: userId}, function (err, newDoc) {
            spark.emit('newUserId', userId);
        });
    });
    spark.on('createGame', function () {
        if (!spark.user) {
            return;
        }

        gameDB.findOne({ userId: spark.user.userId }, function (err, doc) {
            if (doc) {
                return spark.emit('alreadyInGame');
            }

            const joinToken = generateId();

            gameDB.insert({userId: spark.user.userId, joinToken: joinToken, players: [spark.user.userId] }, function (err, newDoc) {
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
                if (doc.players.indexOf(spark.user.userId) < 0) {
                    gameDB.update({ joinToken: token }, { $push: { players: spark.user.userId } }, {}, function (err, changes) {
                        gameDB.findOne({ joinToken: token }, function (err, doc) {
                            primus.forEach(function(spark) {
                                if (doc.players.indexOf[spark.user.userId] > -1) {
                                    spark.emit('updateGame', doc);
                                }
                            });
                        });
                    });
                }
            }
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

            gameDB.remove({userId: spark.user.userId }, function (err) {
                spark.emit('updateGame', null);
            });
        });
    });
    spark.on('login', function (userId) {
        userDB.findOne({ userId: userId }, function (err, doc) {
            if (!doc) {
                return spark.emit('wrongUserId');
            }

            spark.user = doc;

            spark.emit('loggedIn', doc);

            gameDB.findOne({ userId: spark.user.userId }, function (err, doc) {
                if (doc) {
                    return spark.emit('updateGame', doc);
                }
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
