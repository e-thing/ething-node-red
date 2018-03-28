var should = require("should");
var helper = require("node-red-node-test-helper");
var ething = require("../ething.js");

describe('ething Node', function () {

  afterEach(function () {
    helper.unload();
  });

  it('should be loaded', function (done) {
    var flow = [{ id: "n0", type: "ething-controller", name: "ething-controller name", host: 'localhost', port: 80 }];
    helper.load(ething, flow, {
		n0: {
			password: "admin"
		}
	}, function () {
      var n0 = helper.getNode("n0");
      n0.should.have.property('name', 'ething-controller name');
      done();
    });
  });
  
  it('should list all resources', function (done) {
    var flow = [
      { id: "n0", type: "ething-controller", name: "ething-controller name", host: 'localhost', port: 80 },
      { id: "n1", type: "ething-resource-list", name: "ething-resource-list name", controller: "n0", wires:[["n2"]] },
      { id: "n2", type: "helper" }
    ];
    helper.load(ething, flow, {
		n0: {
			password: "admin"
		}
	}, function () {
      var n2 = helper.getNode("n2");
      var n1 = helper.getNode("n1");
      n2.on("input", function (msg) {
        msg.payload.should.be.Array();
        done();
      });
      n1.receive({ payload: "" });
    });
  });
  
});
