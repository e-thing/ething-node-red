var request = require('request');
var EThing = require("ething-js");
var SSE = require('./sse.js')



module.exports = function(RED) {

  /*
  Controller node
  */
  function EThingControllerNode(config) {
    RED.nodes.createNode(this, config);

    var node = this;

    node.log('config: ' + JSON.stringify(config));

    // this controller node handles all communication with the configured ething server

    var host = config.host || 'localhost';
    var port = config.port || 8000;

    EThing.config.serverUrl = 'http://' + config.host + ':' + String(port);

    node.log('EThing api url: ' + EThing.config.serverUrl)

    if (this.credentials && this.credentials.login && this.credentials.password) {
      node.log('EThing set credentials: ' + this.credentials.login + ' ' + this.credentials.password)
      EThing.auth.setBasicAuth(this.credentials.login, this.credentials.password);
    }

    this.ething = EThing;

    // add the EThing instance to the global context
    node.context().global.set("EThing", EThing);

    node.SSE = SSE;

    /*
    SSE events binding
    */
    SSE.on('connected', function () {
      node.log('[EThingControllerNode] events server connected');
      node.emit("stateChanged");
    })

    SSE.on('disconnected', function () {
      node.warn('[EThingControllerNode] events server disconnected');
      node.emit("stateChanged");
    })

    SSE.on('message', function (event) {
      node.log('[EThingControllerNode] events server msg received: ' + JSON.stringify(event));

      node.emit("event", event);
    })


    function startEventServer() {

      if (SSE.state === SSE.CLOSED) {
        node.log('[EThingControllerNode] starting events server');
        SSE.start()
      }
    }

    function stopEventServer() {
      if (SSE.state !== SSE.CLOSED) {
        node.log('[EThingControllerNode] stopping events server');
        SSE.stop()
      }
    }

    function updateEventServerState() {
      if (node.listenerCount('event')) {
        // start the events server
        startEventServer();
      } else {
        // stop the events server
        stopEventServer();
      }
    }

    this.on("newListener", function(event, listener) {
      if (event === "event") setTimeout(updateEventServerState, 1);
    });

    this.on("removeListener", function(event, listener) {
      if (event === "event") setTimeout(updateEventServerState, 1);
    });

    this.on("close", function() {
      stopEventServer();
      node.removeAllListeners('event');
      node.removeAllListeners('stateChanged');
    });

  }

  RED.nodes.registerType("ething-controller", EThingControllerNode, {
    credentials: {
      password: {
        type: "password"
      }
    }
  });

  /*
  list resources admin endpoint
  */
  RED.httpAdmin.get('/ething/resources', function(req, res) {
    EThing.list().then(function(resources) {
      res.json(resources.map(function(resource) {
        return resource.json();
      }));
    });
  });


  /*
  Events node
  */
  function EThingEventsNode(config) {
    RED.nodes.createNode(this, config);

    var controller = RED.nodes.getNode(config.controller);
    var node = this;

    var filter = null;

    if (config.filter) {
      filter = config.filter.split(/[ ,;]/).map(function(n) {
        return n.trim();
      }).filter(function(n) {
        return n !== ''
      });
      if (filter.length === 0)
        filter = null;
    }

    var onevent = function(event) {
      if (filter && filter.indexOf(event.name) === -1) return;
      node.send({
        payload: event,
        event: event.name
      });
    };

    var onstatechanged = function() {
      // update node status
      var fillColor = "grey";
      var text = ''

      if (SSE.state == SSE.CLOSED) {
        fillColor = "red";
        text = "disconnected";
      } else if (SSE.state == SSE.OPEN) {
        fillColor = "green";
        text = "connected";
      } else if (SSE.state == SSE.OPENING) {
        fillColor = "grey";
        text = "connecting";
      }

      node.status({
        fill: fillColor,
        shape: "ring",
        text: text
      });
    };

    controller.addListener('event', onevent);
    controller.addListener('stateChanged', onstatechanged);

    this.on("close", function() {
      controller.removeListener('event', onevent);
      controller.removeListener('stateChanged', onstatechanged);
    });

  }

  RED.nodes.registerType("ething-events", EThingEventsNode);

  /*
  OTHER NODES
  */

  function EThingResourceList (config) {
    RED.nodes.createNode(this, config);

    var controller = RED.nodes.getNode(config.controller);
    var node = this;

    this.on("input", function(msg) {

      var q = config.query || null;
      var anotherQuery = msg.payload;

      if (anotherQuery) {
        if (q) {
          // merge
          q = '(' + q + ') AND (' + anotherQuery + ')';
        } else {
          q = anotherQuery;
        }
      }

      EThing.list(q).then(function(resources) {
        node.send({
          payload: resources
        });
      }).catch(function(err) {
        node.warn(String(err));
      });

    });

  }

  RED.nodes.registerType("ething-resource-list", EThingResourceList);


  function EThingResourceGet(config) {
    RED.nodes.createNode(this, config);
    var controller = RED.nodes.getNode(config.controller);
    var node = this;

    this.on("input", function(msg) {

      var id = config.resource || msg.payload;

      if (id) {
        EThing.get(id).then(function(resource) {
          node.send({
            payload: resource
          });
        }).catch(function(err) {
          node.warn(String(err));
        });
      } else {
        node.warn('no given id');
      }
    });

  }

  RED.nodes.registerType("ething-resource-get", EThingResourceGet);


  function EThingDeviceExecute(config) {
    RED.nodes.createNode(this, config);
    var controller = RED.nodes.getNode(config.controller);
    var node = this;

    this.on("input", function(msg) {

      var id = config.resource;
      var operation = config.operation;
      var args = msg.payload;
      var binary = false;

      if (!id) {
        // find the id in the payload
        if (msg.resource) {
          if (typeof msg.resource === 'string')
            id = msg.resource;
          else
            id = msg.resource.id(); // must be a EThing.Resource instance !
        }
      }

      if (id) {
        if (operation) {
          EThing.Device.execute(id, operation, args, binary).then(function(result) {
            node.send({
              payload: result,
              resource: msg.resource || id,
              args: args
            });
          }).catch(function(err) {
            node.warn(String(err));
          });
        } else {
          node.warn('no given operation');
        }
      } else {
        node.warn('no given id');
      }

    });

  }

  RED.nodes.registerType("ething-device-execute", EThingDeviceExecute);


  function EThingFileRead(config) {
    RED.nodes.createNode(this, config);
    var controller = RED.nodes.getNode(config.controller);
    var node = this;

    this.on("input", function(msg) {

      var id = config.resource;
      var binary = config.binary;

      if (!id) {
        // find the id in the payload
        var r = msg.resource || msg.payload;
        if (r) {
          if (typeof r === 'string')
            id = r;
          else
            id = r.id(); // must be a EThing.Resource instance !
        }
      }

      if (id) {
        EThing.File.read(id, binary).then(function(content) {
          node.send({
            payload: content,
            resource: msg.resource || id
          });
        }).catch(function(err) {
          node.warn(String(err));
        });
      } else {
        node.warn('no given id');
      }

    });

  }

  RED.nodes.registerType("ething-file-read", EThingFileRead);


  function EThingFileWrite(config) {
    RED.nodes.createNode(this, config);
    var controller = RED.nodes.getNode(config.controller);
    var node = this;

    this.on("input", function(msg) {

      var id = config.resource;
      var content = msg.payload;
      var append = config.append;

      if (!id) {
        // find the id in the payload
        if (msg.resource) {
          if (typeof msg.resource === 'string')
            id = msg.resource;
          else
            id = msg.resource.id(); // must be a EThing.Resource instance !
        }
      }

      if (id) {
        EThing.File.write(id, content, append).then(function(resource) {
          // do nothing
        }).catch(function(err) {
          node.warn(String(err));
        });
      } else {
        node.warn('no given id');
      }

    });

  }
  RED.nodes.registerType("ething-file-write", EThingFileWrite);



  function EThingTableRead(config) {
    RED.nodes.createNode(this, config);
    var controller = RED.nodes.getNode(config.controller);
    var node = this;

    this.on("input", function(msg) {

      var id = config.resource;
      var options = {};

      if (typeof config.start === 'number')
        options.start = config.start;
      if (typeof config.length === 'number' && config.length !== 0)
        options.length = config.length;
      if (config.sort)
        options.sort = config.sort;
      if (config.query)
        options.query = config.query;

      if (!id) {
        // find the id in the payload
        var r = msg.resource || msg.payload;
        if (r) {
          if (typeof r === 'string')
            id = r;
          else
            id = r.id(); // must be a EThing.Resource instance !
        }
      }

      if (id) {
        EThing.Table.select(id, options).then(function(content) {
          node.send({
            payload: content,
            resource: msg.resource || id
          });
        }).catch(function(err) {
          node.warn(String(err));
        });
      } else {
        node.warn('no given id');
      }

    });

  }
  RED.nodes.registerType("ething-table-read", EThingTableRead);


  function EThingTableInsert(config) {
    RED.nodes.createNode(this, config);
    var controller = RED.nodes.getNode(config.controller);
    var node = this;

    this.on("input", function(msg) {

      var id = config.resource;
      var data = msg.payload;

      if (!id) {
        // find the id in the payload
        if (msg.resource) {
          if (typeof msg.resource === 'string')
            id = msg.resource;
          else
            id = msg.resource.id(); // must be a EThing.Resource instance !
        }
      }

      if (id) {
        EThing.Table.insert(id, data).then(function(resource) {
          // do nothing
        }).catch(function(err) {
          node.warn(String(err));
        });
      } else {
        node.warn('no given id');
      }

    });

  }
  RED.nodes.registerType("ething-table-insert", EThingTableInsert);

}
