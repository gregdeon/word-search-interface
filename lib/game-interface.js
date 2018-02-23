var $ = require('jquery');
var ReconnectingWebSocket = require('./reconnecting-websocket-min');
var CrowdCurioClient = require('crowdcurio-client')

// Timer class
function Timer(){
    this.start_ms = 0;
    this.stop_ms = 0;
}

Timer.prototype.startTimer = function(){
    this.start_ms = new Date().getTime();
};

Timer.prototype.stopTimer = function(){
    this.stop_ms = new Date().getTime() - this.start_ms;
};

Timer.prototype.getTime = function(){
    return new Date().getTime() - this.start_ms;
}

Timer.prototype.reset = function(){
    this.start_ms = 0;
    this.stop_ms = 0;
}

// WordSearchGrid: data structure for letter grid and word list
function WordSearchGrid(letter_list, word_list)
{
    // size_x and size_y: width and height of grid
    this.size_y = letter_list.length;
    this.size_x = letter_list[0].length;
    
    // Letters: 2D array of letters in grid
    this.letters = [];
    for(var i = 0; i < this.size_y; i++)
    {
        this.letters.push(letter_list[i].split(""));
    }
    
    // Words: collection of {x, y, dx, dy, length, player, found}
    // player: which player ID is responsible for this word (1-3)
    // found: boolean
    // (Text of each word is computed from letter grid)
    this.words = word_list;
    for(var i = 0; i < this.words.length; i++)
    {
        this.words[i].found = false;
    }
}

WordSearchGrid.prototype.updateWord = function(word)
{
    // update is {word_id, found}
    var id = word.word_id;
    var found = word.found;
    this.words[id]['found'] = found;
}

/*
WordSearchGrid.prototype.updateWords = function(word_list)
{
    for(var word_num in word_list)
    {
        this.words[word_num] = word_list[word_num];
    }
}
*/

WordSearchGrid.prototype.getWord = function(word_num)
{
    var ret = "";
    var x  = this.words[word_num]['x'];
    var y  = this.words[word_num]['y'];
    var dx = this.words[word_num]['dx'];
    var dy = this.words[word_num]['dy'];
    
    for(var i = 0; i < this.words[word_num]['length']; i++)
    {
        ret += this.letters[y][x];
        x += dx;
        y += dy;
    }
    return ret;
}

// Check if selecting from (x1, y1) to (x2, y2) matches this word
WordSearchGrid.prototype.checkMatch = function(x1, y1, x2, y2, word_num)
{
    var x_start = this.words[word_num]['x'];
    var y_start = this.words[word_num]['y'];
    var dx = this.words[word_num]['dx'];
    var dy = this.words[word_num]['dy'];
    var len = this.words[word_num]['length'];
    
    var x_end = x_start + dx * (len-1);
    var y_end = y_start + dy * (len-1);

    return (x_start == x1) && (y_start == y1) && (x_end == x2) && (y_end == y2)
}

// Check if selecting from (x1, y1) to (x2, y2) matches any word
// Returns ID of found word or -1
WordSearchGrid.prototype.checkIsWord = function(x1, y1, x2, y2)
{
    for(var i in this.words)
    {
        if(this.words[i]['found'])
            continue;
        if(this.checkMatch(x1, y1, x2, y2, i) ||
           this.checkMatch(x2, y2, x1, y1, i))
            return i;
    }
    return -1;
}

WordSearchGrid.prototype.getScore = function()
{
    // TODO: change which score function to use with a config option

    // Add up score for each line
    var scores = this.getScoreAllLines();
    var score = 0;
    for(var i = 0; i < scores.length; i++)
    {
        score += scores[i];
    }

    return score;
}

WordSearchGrid.prototype.getScoreAllLines = function()
{
    // Find score for every line and return them in a list
    var words_per_player = parseInt(this.words.length / 3);
    var score = [];
    for(var i = 0; i < words_per_player; i++)
    {
        score.push(this.getScoreLine(i));
    }

    return score;
}

WordSearchGrid.prototype.getScoreLine = function(line_num)
{
    // Get the score for one line of the words    
    // This is the per-line superadditive function
    // Assumes that words are ordered: 1/3 for P1, then P2, then P3

    // Points for getting 0, 1, 2, or 3 words in a line
    var score_per_line = [0, 1, 3, 6];
    var words_per_player = parseInt(this.words.length / 3);

    var found = 
        this.words[line_num + 0*words_per_player]['found'] + 
        this.words[line_num + 1*words_per_player]['found'] + 
        this.words[line_num + 2*words_per_player]['found'];

    return score_per_line[found];
}

// Class for handling lobby screen
function WordSearchLobby()
{
    // Client
    this.client = null;
    
    // Which player we are
    this.player_id = -1;
    
    // Which function to call when the game begins
    this.game_start_callback = null;
    
    // Whether the players are ready to play yet
    this.ready = [false, false, false];
    
    // Whether the lobby is the currently active screen
    this.lobby_active = false;
    
    // Timer for game countdown
    this.countdown_timer = new Timer();
    
    // Time limit for countdown
    // TODO: get this from config?
    this.countdown_length = 5000;
    
    // Whether the countdown is active
    this.countdown_active = false;
}

WordSearchLobby.prototype.initialize = function(client, player_id, callback)
{
    this.client = client;
    this.player_id = player_id;
    this.game_start_callback = callback;
    this.lobby_active = true;
    
    // Ask the other players if they're ready 
    this.requestReady();
}

WordSearchLobby.prototype.initHandlers = function()
{
    var that = this;
    $('#lobby-button').click(function(e) {
        // Change this.ready and send message
        that.toggleReady();
        
        
        // Move this code into an end-of-countdown
        //that.callback();
        
        // Make a response so we can track start time
        // TODO: bring this back if we're going to measure time
        //that.client.create('response', {}, function(res){});
    });
    
    $("#debug-button").click(function(e) {
        that.startCountdown();
    });
}

WordSearchLobby.prototype.render = function()
{
    // Set up the HTML structure of the lobby
    var html_string = "";
    html_string += '<div id="lobby-container">';
    html_string += '<div class="lobby-title">Waiting for Players...</div>';

    // Make one status bar for each player
    // TODO: don't hard-code for 3 players
    for(var i = 0; i < 3; i++)
    {
        // One of the players is us
        var player_string = 'Player ' + (i+1);
        if(i == this.player_id)
            player_string += " (you)";
        
        html_string += '<div class="lobby-line-p' + (i+1) + '">';
        html_string += '<div class="lobby-player">' + player_string + '</div>';
        
        // Start with "Not Ready" but update it later
        html_string += '<div class="lobby-ready">Not Ready</div>';
        
        html_string += '</div>';
    }

    html_string += '<div class="lobby-buttons">';
    html_string += '<button type="button" class="btn" id="lobby-button" >Ready</button>';
    // for debugging
    html_string += '<button type="button" class="btn" id="debug-button">Debug</button>';
    html_string += '</div>';
    html_string += '</div>';

    var container_div = $('#task-container');
    container_div.html(html_string);

    // Set up button
    console.log(this);
    this.initHandlers();

    // Update the ready text
    this.renderReady();
}

// Update the Ready/Not Ready lobby text
WordSearchLobby.prototype.renderReady = function()
{
    // Player status
    for(var i = 0; i < 3; i++)
    {
        var status_string = "";
        if(this.ready[i])
            status_string = "Ready";
        else
            status_string = "Not Ready";
        $(".lobby-line-p" + (i+1) + " > .lobby-ready").text(status_string);
    }
    
    // Button
    var button_string = "";
    if(this.ready[this.player_id])
        button_string = "Not Ready";
    else
        button_string = "Ready";
    $("#lobby-button").text(button_string);
}

// Toggle ready
WordSearchLobby.prototype.toggleReady = function()
{
    // Switch ready state
    this.ready[this.player_id] = !this.ready[this.player_id];
    
    // Tell everyone
    this.notifyReady();
    
    // TODO: update our readiness now
    // Is this necessary? Seems pretty fast without
}

// Lobby websocket functions
// Tell everyone else whether or not we're ready
WordSearchLobby.prototype.notifyReady = function()
{
    var event = 
    {
        "type": "update_ready",
        "player": this.player_id,
        "ready": this.ready[this.player_id],
    }
    
    this.client.task_session.send(event);
}

// Ask everyone whether they're ready
WordSearchLobby.prototype.requestReady = function()
{
    console.log("requestReady()");
    console.log(this);
    // Wait for websocket to be connected
    if(!this.client.task_session.present)
    {
        console.log("Not connected yet");
        setTimeout(function(){
            this.requestReady();
        }.bind(this), 500);
        return;
    }
    
    var event = 
    {
        "type": "request_ready",
    }
    
    this.client.task_session.send(event);
}

// Someone said they're ready, so update the lobby screen
WordSearchLobby.prototype.handleReadyUpdate = function(event)
{
    // If we're not in the lobby right now, do nothing
    if(!this.lobby_active)
        return;
    
    // Save the update
    var p = event.player;
    this.ready[p] = event.ready;
    
    // Update the lobby text
    this.renderReady();
    
    // If everyone is ready, start a countdown
    if(this.checkAllReady())
        this.startCountdown();
}

// Check if all players are ready
WordSearchLobby.prototype.checkAllReady = function()
{
    for(var i = 0; i < 3; i++)
    {
        if(!this.ready[i])
            return false;
    }
    
    return true;
}

// All players are ready, so start a countdown
WordSearchLobby.prototype.startCountdown = function()
{
    // If we're already counting down, do nothing
    if(this.countdown_active)
        return;
    
    // Start the timer
    this.countdown_timer.startTimer();
    
    // Update the screen repeatedly
    this.updateCountdown();
    
    // Alert user that the game is starting soon
    var seconds = Math.ceil(this.countdown_length / 1000);
    alert("Game starting in " + seconds + " seconds");
    
    // TODO: send message to keep everyone synced
}

WordSearchLobby.prototype.updateCountdown = function()
{
    // Find how long we have left
    var time_elapsed = this.countdown_timer.getTime();
    var time_left = this.countdown_length - time_elapsed;
    
    // If we're done, start the game
    if(time_left <= 0)
    {
        this.lobby_active = false;
        this.game_start_callback();
    }
    // Otherwise, update the lobby and do this again later
    else
    {
        var seconds_left = Math.ceil(time_left / 1000);
        var title_string = "Game starting in " + seconds_left;
        $(".lobby-title").text(title_string);
        
        var that = this;
        setTimeout(function(e){that.updateCountdown()}, 100);
    }
    
}


function WordSearchInterface() 
{
    // Number of players in the game
    // TODO: use this everywhere
    this.num_players = 3;

    // Which player we are
    this.player_id = -1;
    
    // current screen: loading, lobby, game, or score
    this.mode = "loading";

    // Puzzle data for game - mainly loaded from Data object
    this.grid = null;
    
    // Game state
    this.timer = new Timer();
    this.selecting = false;
    this.select_x1 = 0;
    this.select_y1 = 0;
    this.select_x2 = 0;
    this.select_y2 = 0;
    
    // Lobby object
    this.lobby = new WordSearchLobby();
}

// Helper function: find which player we are
// Do this at startup 
WordSearchInterface.prototype.getPlayerID = function()
{
    // Find out who we are
    var task_session_id = this.client.task_session.task_session;
    var self_user_id = this.client.user.id;
//    console.log(this.client.task_session.connected_users);

    // Get list of members
    var that = this;
    this.client.listAll('tasksessionmember', {'task_session': task_session_id}, function(res){
        // Find us
        for(var i = 0; i < res.length; i++)
        {
            if(res[i].user.id == self_user_id)
            {
                that.player_id = i;
                break;
            }
        }    

        console.log("Player ID: " + that.player_id)
        
        // Now we're really ready to start
        that.postInitialize();
    });
}


WordSearchInterface.prototype.initialize = function(config)
{
    var that = this;
    this.client = new CrowdCurioClient();
    this.client.init({
        user: global.user,
        task: global.task,
        experiment: global.experiment,
        condition: global.condition,
        configuration: config
    }).then(function(){
        // Render loading screen
        that.render();
        
        // Find our player ID
        that.getPlayerID();
        
    });

    this.client.task_session.setListeners({
        "save": this.handleNotification.bind(this),
        "delete": this.handleNotification.bind(this)
    });
}

WordSearchInterface.prototype.postInitialize = function()
{
    // Initialize our lobby object
    this.lobby.initialize(this.client, this.player_id, this.startGame.bind(this));
    
    // Start the first task at the lobby
    this.getNextTask();
}

// ----- Rendering functions: set up HTML for page

// High-level rendering function
// Render the correct screen depending on which mode we're in
WordSearchInterface.prototype.render = function()
{
    var functions = {
        "loading": this.renderLoading,
        "lobby": this.lobby.render.bind(this.lobby),
        "game": this.renderGame,
        "score": this.renderScoreScreen
    }

    var render_func = functions[this.mode].bind(this);

    if(render_func)
    {
        render_func();
    }
    else
    {
        console.log("Unrecognized rendering mode " + mode);
    }
}

// Render a loading screen
// This way, something is on screen while we're waiting for our player number
WordSearchInterface.prototype.renderLoading = function()
{
    var html_string = "";
    html_string += '<div id="lobby-container">';
    html_string += '<div class="lobby-title">Loading...</div>';
    html_string += '</div>'

    var container_div = $('#task-container');
    container_div.html(html_string);
}

// Render the game screen
WordSearchInterface.prototype.renderGame = function()
{   
    // Build word search grid
    var html_string = "<div id='word-search-game'>";

    // Sidebox
    html_string += this.renderSidebox(this.grid)

    // Grid
    html_string += "<div class='word-search-grid'>";
    for(var iy = 0; iy < this.grid.size_y; iy++)
    {
        html_string += "<div class='word-search-line'>";
        for(var ix = 0; ix < this.grid.size_x; ix++)
        {
            var id_string = 'id=box-x' + ix + '-y' + iy;
            html_string += "<div " + id_string + " class='word-search-letter' protected-text='" + this.grid.letters[iy][ix] + "' >";
            html_string += "</div>";
        }
        html_string += "</div>";
    }
    html_string += "</div>"
    html_string += "</div>"

    // Debug
    html_string += "<br> <button type='button' id='reset-button'>Reset Puzzle</button>";
    html_string += "<button type='button' id='next-button' class='btn'>Next Puzzle</button>";

    var container_div = $('#task-container');
    container_div.html(html_string);


    this.initHandlersGame();
}

// Returns an HTML string with the word lists
WordSearchInterface.prototype.renderSidebox = function(grid)
{
    var player_list = [];
    var html_strings = {};

    for(var i = 0; i < grid.words.length; i++)
    {
        var player = grid.words[i].player;

        // Check if we already have an item for this player
        if(player_list.indexOf(player) == -1)
        {
            // Not in list yet -- start a new word list
            player_list.push(player);
            html_strings[player] = [];
        }

        // Add this word to this player's list
        var id_string = "id=word-" + i;
        var html_string = "<div " + id_string + " class='word-search-word'>";
        html_string += this.grid.getWord(i);
        html_string += "</div>";
        html_strings[player].push(html_string);
    }

    // Wrap it all up in a sidebox
    var ret = "";
    ret += "<div class='word-search-sidebox'>";

    // Header
    var header_strings = [
        // TODO: put puzzle ID in data objects
        // something like this.grid.puzzle_num
        "<b>Puzzle: </b> <div id='sidebox-puzzle-num'>TODO</div>",
        "<b>Player: </b> <div id='sidebox-player-num'>" + (this.player_id + 1) + "</div>",
        "<b>Time: </b> <div id='sidebox-time'>0</div>"
    ];

    ret += "<div class='word-search-header'>";
    for(var i = 0; i < header_strings.length; i++)
    {
        ret += "<div class='word-search-header-item'>";
        ret += header_strings[i];
        ret += "</div>";
    }
    ret += "</div>";
    
    // Players
    player_list.sort();
    ret += "<table>";
    ret += "<tr>";
    for(var i = 0; i < player_list.length; i++)
        ret += "<th class='word-search-sidebox-th'>Player " + player_list[i] + "</th>";
    ret += "<th>Score</th>";
    ret += "</tr>";

    // Words
    // Assume all lists the same length
    var list_length = html_strings[player_list[0]].length;
    for(var i = 0; i < list_length; i++)
    {
        ret += "<tr>";
        for(var j = 0; j < player_list.length; j++)
            ret += "<td>" + html_strings[player_list[j]][i] + "</td>";
        ret += "<td><div id=score-" + i + ">0</div></td>";
        ret += "</tr>";
    }

    // Final line
    ret += "<tr>"
    for(var j = 0; j < player_list.length; j++)
        ret += "<td></td>";
    ret += "<td><div id=score-total>0</div></td></tr>";
    ret += "</table></div>";

    return ret;
}

// TODO: move this into separate class
WordSearchInterface.prototype.renderScoreScreen = function()
{
    // TODO
}

// ----- Game screen updates - change the appearance of the screen mid-game

// Find the x and y coordinates of one of the boxes
WordSearchInterface.prototype.getXYFromId = function(id)
{
    var id_split = id.split("-");
    var ix = parseInt(id_split[1].slice(1));
    var iy = parseInt(id_split[2].slice(1));
    return [ix, iy];
}

// Find the ID of one of the boxes
WordSearchInterface.prototype.getIdFromXY = function(x, y)
{
    return "box-x" + x + "-y" + y
}

// Add a class to one of the boxes
// val can be true (add class), false (remove class), or null (toggle class)
WordSearchInterface.prototype.setClass = function(x, y, cls, val)
{
    var id = this.getIdFromXY(x, y)
    var elem = $("#" + id)
    
    if (val !== null)
    {
        elem.toggleClass(cls, val)
    }
    else
    {
        elem.toggleClass(cls)
    }
}

// Mark a letter as found or not found
// found takes same values as setClass()
WordSearchInterface.prototype.setFound = function(x, y, found, player)
{
    this.setClass(x, y, "letter-found-p" + player, found);
}

// Mark a letter as selected or not selected
// selected takes same values as setClass()
WordSearchInterface.prototype.setSelected = function(x, y, selected)
{
    this.setClass(x, y, "letter-selected", selected);
}

// Mark an entire word as found or not
// Assumes that words don't intersect
WordSearchInterface.prototype.setWordFound = function(word_num, found)
{
    // Mark each letter as found
    var word = that.grid.words[word_num];
    var x = word['x'];
    var y = word['y'];
    var dx = word['dx'];
    var dy = word['dy'];
    var length = word['length'];
    var player = word['player'];  
    
    for(var j = 0; j < length; j++)
    {
        that.setFound(x + dx*j, y + dy*j, found, player);
    }    
    
    // Mark as found in the sidebar
    var word_id = "word-" + word_num;
    $('#' + word_id).toggleClass('word-found', found);
}

/*
WordSearchInterface.prototype.updateFoundWords = function()
{
    // TODO: make this more efficient (one word at a time?)
    console.log('getting words from client')
    that = this;
    filters = {
        "owner": this.client.user.id,
        "data" : this.client.data.id,
        "task" : this.client.task.id,
        "experiment": this.client.experiment.id,
        "condition": this.client.condition.id
    };
    
    this.client.listAll('annotation', filters, function(res){
        // debug
        console.log(res)
        
        // Fill in "found" words
        for(var i = 0; i < res.length; i++)
        {
            // Ignore late-coming annotations (for previous data object)
            if(res[i].data.id != that.client.data.id)
                continue;
            
            var update = {};
            update.word_id = res[i].position;
            update.found = (res[i].label === "true")
            that.grid.updateWord(update)
        }
    
        console.log('updating words');
        for(var iy = 0; iy < that.grid.size_y; iy++)
        {
            for(var ix = 0; ix < that.grid.size_x; ix++)
            {
                that.setFound(ix, iy, false, 1);
                that.setFound(ix, iy, false, 2);
                that.setFound(ix, iy, false, 3);
            }
        }

        for(var i = 0; i < that.grid.words.length; i++)
        {
            var word = that.grid.words[i];

            var found = word['found']
            if(!found)
                continue;

            var x = word['x'];
            var y = word['y'];
            var dx = word['dx'];
            var dy = word['dy'];
            var length = word['length'];
            var player = word['player'];
            
            for(var j = 0; j < length; j++)
            {
                that.setFound(x + dx*j, y + dy*j, true, player);
            }    
            
            var word_id = "word-" + i;
            $('#' + word_id).toggleClass('word-found', true);
        }


        that.updateScores();
    })

    // TODO: make this work?
    // Until then, we're missing the most recent word
    .then(function(){
        console.log("OK");
        that.updateScores();
    });
}
*/

// Update the letters that are highlighted locally
WordSearchInterface.prototype.updateHighlighting = function()
{
    var dx = this.select_x2 - this.select_x1;
    var dy = this.select_y2 - this.select_y1;
    var len2 = dx*dx + dy*dy;
    
    // Check each letter independently
    for(var iy = 0; iy < this.grid.size_y; iy++)
    {
        for(var ix = 0; ix < this.grid.size_x; ix++)
        {
            // If we're not highlighting anything, set it as not selected
            if(!this.selecting)
            {
                this.setSelected(ix, iy, false);
            }
            // Otherwise, only highlight letters that are in line with the 
            // selected endpoints
            else 
            {
                var dxi = ix - this.select_x1;
                var dyi = iy - this.select_y1;
                
                var in_line = false;
                if(len2 == 0)
                {
                    in_line = (dxi == 0 && dyi == 0);
                }
                else
                {
                    var cross = dyi * dx - dxi * dy;
                    var dot = dxi * dx + dyi * dy;
                    in_line = ((cross == 0) && (dot >= 0) && (dot <= len2))
                }
                
                this.setSelected(ix, iy, in_line);
            }
        }
    }
}

// Update the scores in the sidebox
WordSearchInterface.prototype.updateScores = function()
{
    // Get a list of all scores
    var scores = this.grid.getScoreAllLines()
    
    // Draw scores and find total
    var total_score = 0;
    for(var i = 0; i < scores.length; i++)
    {
        $("#score-" + i).text(scores[i]);
        total_score += scores[i];
    }

    $("#score-total").text(total_score);
}

// ----- Game logic
// Update the locally selected words with a new mouse x position
WordSearchInterface.prototype.updateSelection = function(x, y)
{
    // new potential values of x2, y2
    // only change if selected word is orthogonal/diagonal
    var dx = x - this.select_x1;
    var dy = y - this.select_y1;
    
    if(dx == 0 || dy == 0 || Math.abs(dx) == Math.abs(dy))
    {
        this.select_x2 = x;
        this.select_y2 = y;
    }
}

// User clicked to end a word
WordSearchInterface.prototype.confirmSelection = function()
{
    var word_num = this.grid.checkIsWord(
        this.select_x1, 
        this.select_y1, 
        this.select_x2, 
        this.select_y2
    );
    
    // If this isn't a word, do nothing
    if(word_num < 0)
        return;
    
    console.log("confirmed selection: word " + word_num);
    
    // If this word isn't ours, do nothing
    var word = that.grid.words[word_num];
    var player = word['player'];  
    if(this.player_id + 1 != player)
        return;

    // All good - officially find this word
    this.findWord(word_num);
}

// Mark a word as found
WordSearchInterface.prototype.findWord = function(word_num)
{
    // Make an annotation
    // This also sends a message
    var data = {
        'position': word_num,
        'label': "true"
    }
    this.client.create('annotation', data, function(res){});
}

// Show a new word as found after receiving a websocket message
WordSearchInterface.prototype.handleWordFound = function(annotation)
{
    var word_num = annotation.position;
    
    // Update the grid data structure
    var update = {};
    update.word_id = word_num;
    update.found = true;
    this.grid.updateWord(update);
    
    // Update UI
    this.setWordFound(word_num, true);
    this.updateScores();
    
    // Safety: update all words in case we've gone out of sync?
    // Need to avoid recursive call if we do this
    //this.updateAllWords();
}

// Recover the entire list of found words from the server
WordSearchInterface.prototype.updateAllWords = function()
{
    console.log(this);
    that = this;
    filters = {
        "task_session": this.client.task_session.task_session,
        "data" : this.client.data.id,
        "task" : this.client.task.id,
        "experiment": this.client.experiment.id,
        "condition": this.client.condition.id
    };
    
    this.client.listAll('annotation', filters, function(res){
        // debug
        console.log(res)
        
        // Pretend that we've gotten websocket messages for each one
        for(var i = 0; i < res.length; i++)
        {
            // Ignore late-coming annotations (for previous data object)
            if(res[i].data.id != that.client.data.id)
                continue;
            
            var event = {}
            event.position = parseInt(res[i].position);
            // TODO: what to do with res[i].label?
            // maybe check if it's "true" or "false"
            that.handleWordFound(event);
        }
    });
}


WordSearchInterface.prototype.initHandlersGame = function()
{
    console.log("Initializing game handlers...");
    that = this;
    // Grid mouse click handlers
    $('.word-search-letter').click(function(e) {
        var position = that.getXYFromId(e.target.id);
        var p_x = position[0]
        var p_y = position[1]
        
        // First click: start selecting
        if(!that.selecting)
        {
            that.selecting = true;
            that.select_x1 = p_x;
            that.select_y1 = p_y;
            that.select_x2 = p_x;
            that.select_y2 = p_y;
        }
        // Second click: confirm selection
        else
        {
            that.confirmSelection();
            that.selecting = false;
        }
        
        // Either way, update which letters are highlighted
        that.updateHighlighting();
    });
    
    // Grid mouseover handlers
    $('.word-search-letter').mouseover(function(e) {
        // Update highlighted words
        var position = that.getXYFromId(e.target.id);
        var p_x = position[0]
        var p_y = position[1]
        
        if(that.selecting)
        {
            that.updateSelection(p_x, p_y);
        }
        
        that.updateHighlighting();
    });
    
    // Debug: reset all annotations
    $('#reset-button').click(function(e) {
        that.client.listAll('annotation', {}, function(res){
            for(var i = 0; i < res.length; i++)
            {
                that.client.delete('annotation', {'id': res[i].id}, function(res) {
                    that.updateFoundWords();
                });
            }

        });
    });

    // Debug: go to next puzzle
    $('#next-button').click(function(e) {
        that.getNextTask();
    });
}

WordSearchInterface.prototype.getNextTask = function()
{
    var that = this;
    this.client.getNextTask('', function(task) {
        if($.isEmptyObject(task))
        {
            alert("All done! Thanks for your help.");
            return;
        }

        that.client.setData(task['id'])
        that.mode = "lobby";

        var letter_list = task.content.letter_list;
        var word_list = task.content.word_list;
        that.grid = new WordSearchGrid(letter_list, word_list);
        that.render();
        //that.updateFoundWords();
    });

}

// Sidebar: update timer
WordSearchInterface.prototype.updateTimer = function()
{
    var time_elapsed = this.timer.getTime();
    var time_s = parseInt(time_elapsed / 1000);
    $("#sidebox-time").text(time_s);
}

// Start the game
WordSearchInterface.prototype.startGame = function()
{
    // Switch to game mode and draw the UI
    this.mode = "game";
    this.render();
    this.updateAllWords();

    // Start the timer and make it update often
    this.timer.startTimer();
    setInterval(this.updateTimer.bind(this), 200);
}


// Websocket things
WordSearchInterface.prototype.handleNotification = function(message)
{
    console.log("received notification");
    console.log(message);
    
    // Two types of notifications
    var event = message.payload.event;
    var annotation = message.payload.annotation;
    
    // 1: messages we send
    if(event)
    {
        console.log(event);
        switch(event.type)
        {
            // Readiness update (lobby)
            case "update_ready":
                this.lobby.handleReadyUpdate(event);
                break;
                
            // Readiness request (lobby)
            case "request_ready":
                this.lobby.notifyReady();
                break;
        }
    }
    // 2: annotations (found words)
    else if(annotation)
    {
        this.handleWordFound(annotation);
    }
    
}

module.exports = WordSearchInterface;