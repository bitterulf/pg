'use strict';

const Primus = require('primus');

const Path = require('path');
const Hapi = require('hapi');
const Inert = require('inert');
const generateId = require('shortid').generate;

const Datastore = require('nedb')
const userDB = new Datastore({ filename: './db/user', autoload: true });

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
    spark.on('login', function (userId) {
        userDB.findOne({ userId: userId }, function (err, doc) {
            if (!doc) {
                return spark.emit('wrongUserId');
            }

            spark.user = doc;

            spark.emit('loggedIn');
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
