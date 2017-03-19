// Copyright IBM Corp. 2015. All Rights Reserved.
// Node module: strong-pubsub-bridge
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

module.exports = Bridge;

var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var debug = require('debug')('strong-pubsub-bridge');
var debugAction = require('debug')('strong-pubsub-bridge:action');

/**
 * Forward the events of a `connection` using the provided `client`. Also
 * forward the events of the provided `client` to the `connection`.
 *
 * **Example**
 *
 * ```js
 * var net = require('net');
 * var server = net.createServer();
 *
 * var Adapter = require('strong-pubsub-mqtt');
 * var client = new Client('mqtt://my.mosquitto.org', Adapter);
 * var Connection = require('strong-pubsub-connection-mqtt');
 *
 * server.on('connection', function(connection) {
 *   var mqttConnection = new Connection(connection);
 *   var bridge = new Bridge(mqttConnection, client);
 * });
 * ```
 *
 * @prop {Connection} connection The `Connection` instance provided to the `Bridge` constructor.
 * @prop {Client} client The `Client` instance provided to the `Bridge` constructor.
 * @prop {Object[]} hooks An array hook objects.
 * @class
 */

function Bridge(connection, client) {
  EventEmitter.call(this);
  var bridge = this;
  this.connection = connection;
  this.client = client;
  var hooks = this.hooks = {};
}

inherits(Bridge, EventEmitter);

Bridge.actions = ['connect', 'publish', 'subscribe', 'unsubscribe'];

/**
 * Connect the bridge to the broker using the provided `client` and `connection`.
 */

Bridge.prototype.connect = function() {
  var bridge = this;
  var hooks = this.hooks;
  var client = this.client;
  var connection = this.connection;

  client.on('message', function(topic, message, options) {
    debug('message received from topic: %s', topic);
    connection.publish(topic, message, options);
  });

  Bridge.actions.forEach(function(action) {
    hooks[action] = hooks[action] || [];

    connection.on(action, function(ctx) {
      debugAction(action + ' %j', ctx);
      bridge.trigger(action, ctx, function(err) {
        ctx.error = err;

        if(action === 'connect') {
          return done();
        }

        if(err) {
          return connection.onError(action, ctx, err);
        }

        if(ctx.authorized === false || ctx.reject) {
          return done();
        }

        switch(action) {
          case 'publish':
            client.publish(ctx.topic, ctx.message, ctx.options, done);
          break;
          case 'subscribe':
            client.subscribe(ctx.subscriptions || ctx.topic, ctx.options, done);
          break;
          case 'unsubscribe':
            client.unsubscribe(ctx.unsubscriptions || ctx.topic, done);
          break;
        }
      });

      function done(err) {
        if(err) {
          // error interacting with broker
          error(err);
          client.end();
        }

        connection.ack(action, ctx, function(err) {
          if(err) {
            // error sending ack
            debug('closing connection');
            connection.close();
            error(err);
          }
        });
      }
    });
  });

  client.on('error', error);
  connection.on('error', error);

  function error(err) {
    bridge.emit('error', err);
  }
}

/**
 * Add a `hook` function before the given `action` is executed.
 *
 * @param {String} action Must be one of the following:
 *
 * - `connect`
 * - `publish`
 * - `subscribe`
 * - `unsubscribe`
 *
 * @param {Function} hook The function to be called before the action.
 *
 * **Example**:
 * 
 * ```js
 * bridge.before('connect', function(ctx, next) {
 *   if(ctx.auth.password !== '1234') {
 *     ctx.badCredentials = true;
 *   }
 *   next();
 * });
 * ```
 *
 * **Action Context**
 * 
 * The `ctx` object has the following properties for the specified actions.
 *
 * **Action: `connect`**
 *
 * - `ctx.auth` - `Object` containing auth information
 * - `ctx.auth.username` - `String` containing client username
 * - `ctx.auth.password` - `String` containing client password
 * - `ctx.authorized` - `Boolean` Defaults to `true`. Set to `false` in a hook to send back an unathorized response.
 * - `ctx.reject` - `Boolean` Defaults to false. Set to `true` to reject the action.
 * - `ctx.clientId` - `String` containing the id of the client.
 * - `ctx.badCredentials` - `Boolean` Defaults to false. Set to `true` if the provided credentials are invalid.
 *
 * **Action: `publish`**
 * 
 * - `ctx.topic` - `String` the topic the client would like to publish the message to
 * - `ctx.message` - `String` or `Buffer` the message to publish
 * - `ctx.options` - `Object` protocol specific options
 * - `ctx.authorized` - `Boolean` Defaults to `true`. Set to `false` in a hook to send back an unathorized response.
 * - `ctx.reject` - `Boolean` Defaults to false. Set to `true` to reject the action.
 * - `ctx.clientId` - `String` containing the id of the client.
 * 
 * **Action: `subscribe`**
 * 
 * - `ctx.topic` - `String` the topic the client would like to publish the message to
 * - `ctx.subscriptions` - `Object` containing a topics as keys and options as values.
 * Only `ctx.topic` or `ctx.subscriptions` will be set.
 * - `ctx.options` - `Object` protocol specific options
 * - `ctx.authorized` - `Boolean` Defaults to `true`. Set to `false` in a hook to send back an unathorized response.
 * - `ctx.reject` - `Boolean` Defaults to false. Set to `true` to reject the action.
 * - `ctx.clientId` - `String` containing the id of the client.
 * 
 * **Event: `unsubscribe`**
 * 
 * Emitted with a `ctx` object containing the following.
 * 
 * - `ctx.topic` - `String` the topic the client would like to unsubscribe from.
 */

Bridge.prototype.before = function(action, hook) {
  if (typeof hook !== 'function') {
    throw new Error('hook function required');
  }
  if (!this.hooks[action]){
    this.hooks[action]=[]
  }
    this.hooks[action].push(hook);
}

Bridge.prototype.trigger = function(action, ctx, cb) {
  var hooks = this.hooks[action];
  var numHooks = hooks && hooks.length;
  var cur = 0;

  if(!numHooks) {
    return process.nextTick(cb);
  }

  hooks[0](ctx, next);

  function next(err) {
    if(err || !hooks[cur + 1]) {
      return cb(err);
    }

    hooks[++cur](ctx, next);
  }
}
