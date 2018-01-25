global.jQuery = require("jquery")
global.$ = require("jquery")
var WordSearchInterface = require('./game-interface');

// set global UI vars
global.DEV = false;
global.task = window.task || -1;
global.user = window.user || -1;
global.experiment = window.experiment || -1;
var config = window.config || {};

function start(configuration){
	var interface = new WordSearchInterface();
	interface.initialize(configuration);
}

// call start
start(config);