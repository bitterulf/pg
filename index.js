'use strict';

const Primus = require('primus');

const Path = require('path');
const Hapi = require('hapi');
const Inert = require('inert');
const generateId = require('shortid').generate;

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
        spark.emit('newUserId', generateId())
    });
    spark.on('login', function (userId) {
        console.log('user logged in:', userId);
        spark.emit('loggedIn');
    });
});

server.start((err) => {

    if (err) {
        throw err;
    }

    console.log('Server running at:', server.info.uri);
});
