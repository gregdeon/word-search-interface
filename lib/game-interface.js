var $ = require('jquery');
var ReconnectingWebSocket = require('./reconnecting-websocket-min');
var CrowdCurioClient = require('crowdcurio-client')
var ScoreCalculator = require('./score-calculator')

// Timer class
function Timer(){
    this.start_ms = 0;
    this.stop_ms = 0;
    this.running = false;
}

Timer.prototype.startTimer = function(){
    this.start_ms = new Date().getTime();
    this.running = true;
};

Timer.prototype.stopTimer = function(){
    this.stop_ms = new Date().getTime() - this.start_ms;
    this.running = false;
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

// Get a list of booleans for each word
WordSearchGrid.prototype.getFoundList = function()
{
    var ret = [];
    for(var i = 0; i < this.words.length; i++)
    {
        ret.push(this.words[i].found);
    }
    return ret;
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


function WordSearchInterface() 
{
    // Number of players in the game
    // TODO: use this everywhere
    this.num_players = 3;

    // Which player we are
    this.player_id = -1;

    // Player statuses
    // 0 = not ready, 1 = ready for puzzle, 2 = done puzzle
    // TODO: coordinate this with lobby object
    this.player_status = [0, 0, 0];

    // Which puzzle we're working on
    this.puzzle_id = -1;
    this.num_puzzles = 5;
    
    // current screen
    // options:
    // - loading: pre-lobby screen
    // - lobby: waiting for players
    // - pre_game: countdown before puzzle starts
    // - game: puzzle
    // - pre_score: countdown before score screen
    // - score: payment selection screen
    this.mode = "loading";

    // Safety lock during mode switches
    this.mode_changing = false;

    // Timing information 
    this.timer_length = {
        // Lobby timer: 5 mins before option to leave
        "lobby": 5*60*1000,
        // Time before game starts
        // DEBUG: short pre-game timer
        "pre_game": 500, //5000,
        // Time limit for puzzle
        // TODO: get this from config
        "game": 15000,
        // Time for "calculating score..." screen
        "pre_score": 3000,
        // Time for selecting payment
        "score": 60000
    };

    // Timing
    this.timer = new Timer();

    // ----- Game state
    // Puzzle data for game - mainly loaded from Data object
    this.grid = null;

    // Game state
    this.selecting = false;
    this.select_x1 = 0;
    this.select_y1 = 0;
    this.select_x2 = 0;
    this.select_y2 = 0;

    // Score calculator object
    // TODO: use config to set up different scoring functions
    this.score_calculator = new ScoreCalculator();
}

// ----- Game internals - synchronizing with players and starting task
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

        // Start checking the timer
        setInterval(function(){that.pollTimer();}, 200);
    });

    this.client.task_session.setListeners({
        "save": this.handleNotification.bind(this),
        "delete": this.handleNotification.bind(this),
        // TODO: handle task switches
        "task_switch": this.handleNotification.bind(this),
    });
}

WordSearchInterface.prototype.postInitialize = function()
{
    // Open the lobby
    this.startState("lobby");
}

// Move to a new screen
WordSearchInterface.prototype.startState = function(state)
{
    // Lock and switch game modes 
    this.mode_changing = true
    this.mode = state;

    // Render the new screen
    this.render();

    // Restart the timer
    this.timer.startTimer();

    // Extra things to do in each state
    switch(state)
    {
        case "loading":
            // We shouldn't ever go back to the loading screen...
            break;

        case "lobby":
            // Get the other teammates' status
            this.requestStatus();
            break;

        case "pre_game":
            // TODO: 
            break;

        case "game":
            // Update the found words 
            this.updateAllWords();

        case "pre_score":
            // TODO
            break;

        // Starting the score screen
        case "score":
            break;
    }

    // Unlock
    this.mode_changing = false;
}

// Timer-related functions
WordSearchInterface.prototype.pollTimer = function()
{
    // If we're locked, don't do anything
    if(this.mode_changing)
        return;

    // We don't care about the timer in the loading screen
    if(this.mode == "loading")
        return;

    // Get time left on this mode
    var time_elapsed = this.timer.getTime();
    var time_left = this.timer_length[this.mode] - time_elapsed;
    var time_s = Math.ceil(time_left / 1000);

    // Use this time
    switch(this.mode)
    {
        case "lobby":
            // TODO: show early exit button
            break;

        case "pre_game":
            // Update counter
            this.renderPreGameCounter(time_s);

            // If the countdown is done, start the game
            if(time_left <= 0)
                this.startState("game");
            break;

        case "game":
            $("#sidebox-time").text(time_s);

            // When the game time limit is up, show the calculation screen
            if(time_left <= 0)
                this.startState("pre_score");
            break;

        case "pre_score":
            // When "calculating" is done, show the score screen
            if(time_left <= 0)
                this.startState("score");
            break;

        case "score":
            if(time_left <= 0)
                // TODO: Request next task 
                this.startState("pre_game");
            break;
    }
}

// Ask CrowdCurio for the next task
WordSearchInterface.prototype.getNextTask = function()
{
    var that = this;

    // Request task
    this.client.getNextTask('', function(task) {
        // If we got nothing, we're finished
        if($.isEmptyObject(task))
        {
            // TODO: show game over screen (post-study questionnaire?)
            // (How?)
            alert("All done! Thanks for your help.");
            return;
        }

        // Save this task's ID
        that.client.setData(task['id'])

        // Build our word lists
        var letter_list = task.content.letter_list;
        var word_list = task.content.word_list;
        that.grid = new WordSearchGrid(letter_list, word_list);
        that.updatePuzzleId();

        // Start the timer
        that.startState("pre_game");
    });
}

WordSearchInterface.prototype.updatePuzzleId = function()
{
    var puzzles_left = this.client.router.queues['']['total'];
    this.puzzle_id = this.num_puzzles - puzzles_left + 1;
}


// ----- Websocket things
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
            // Status update
            case "update_status":
                this.handleStatusUpdate(event);
                break;

            // Status request
            case "request_status":
                this.notifyStatus();
                break;
        }
    }
    // 2: annotations (found words)
    else if(annotation)
    {
        this.handleWordFound(annotation);
    }
    // TODO: where is "task_switch"?
}

// Tell everyone else whether or not we're ready
WordSearchInterface.prototype.notifyStatus = function()
{
    var event = 
    {
        "type": "update_status",
        "player": this.player_id,
        "ready": this.player_status[this.player_id],
    }
    
    this.client.task_session.send(event);
}

// Ask everyone whether they're ready
WordSearchInterface.prototype.requestStatus = function()
{
    console.log("requestStatus()");
    // Wait for websocket to be connected
    if(!this.client.task_session.present)
    {
        console.log("Not connected yet");
        setTimeout(function(){
            this.requestStatus();
        }.bind(this), 500);
        return;
    }
    
    var event = 
    {
        "type": "request_status",
    }
    
    this.client.task_session.send(event);
}

// Someone said they're ready, so update the lobby screen
WordSearchInterface.prototype.handleStatusUpdate = function(event)
{    
    // Save the update
    var p = event.player;
    this.player_status[p] = event.ready;
    
    // Other screen-specific handling
    switch(this.mode)
    {
        case "lobby":
            // Update status rendering
            this.renderLobbyReady();    

            // If everyone is ready, start a countdown
            if(this.checkAllReady())
//                this.startCountdown();
                this.startState("pre_game");

            break;


        // TODO: remove this
        /*
        case "wait_score":
            // TODO: show players' status

            // If everyone is ready, move on to the score screen
            if(this.checkAllFinished())
                this.startScoreScreen();
        */
    }
}

// Set our status (not ready/ready to play/finished game)
// Useful for lobby and waiting screens
WordSearchInterface.prototype.setStatus = function(status)
{
    // Switch ready state
    this.player_status[this.player_id] = status;
    
    // Tell everyone
    this.notifyStatus();
    
    // TODO: update our readiness now
    // Is this necessary? Seems pretty fast without
}

// ----- Rendering functions: set up HTML for page

// High-level rendering function
// Render the correct screen depending on which mode we're in
WordSearchInterface.prototype.render = function()
{
    var functions = {
        "loading": this.renderLoading,
        "lobby": this.renderLobby,
        "pre_game": this.renderPreGame,
        "game": this.renderGame,
        "pre_score": this.renderPreScore,
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

// Render the pre-game lobby
WordSearchInterface.prototype.renderLobby = function()
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
    this.initHandlersLobby();

    // Update the ready text
    this.renderLobbyReady();
}


// Update the Ready/Not Ready lobby text
WordSearchInterface.prototype.renderLobbyReady = function()
{
    // Player status
    for(var i = 0; i < 3; i++)
    {
        var status_string = "";
        if(this.player_status[i] == 1)
            status_string = "Ready";
        else
            status_string = "Not Ready";
        $(".lobby-line-p" + (i+1) + " > .lobby-ready").text(status_string);
    }
    
    // Button
    var button_string = "";
    if(this.player_status[this.player_id] == 1)
        button_string = "Not Ready";
    else
        button_string = "Ready";
    $("#lobby-button").text(button_string);
}

// Render the game countdown
WordSearchInterface.prototype.renderPreGame = function()
{
    // Simple HTML structure
    var html_string = "";
    html_string += '<div id="lobby-container">';
    html_string += '<div class="lobby-title">Game starting in...</div>';
    html_string += '</div>';

    var container_div = $('#task-container');
    container_div.html(html_string);

    // Update the ready text
    var initial_seconds = Math.ceil(this.timer_length["pre_game"] / 1000)
    this.renderPreGameCounter(initial_seconds);
}

// Update the counter on the pre-game screen
WordSearchInterface.prototype.renderPreGameCounter = function(seconds_left)
{
    // Update string
    var counter_string = "Game starting in " + seconds_left + "...";
    $(".lobby-title").text(counter_string);
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
        "<b>Puzzle: </b> <div id='sidebox-puzzle-num'>" + this.puzzle_id + "/" + this.num_puzzles + "</div>",
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

WordSearchInterface.prototype.renderPreScore = function()
{
    var html_string = "";
    html_string += '<div id="lobby-container">';
    html_string += '<div class="lobby-title">Game Over!</div>';
    html_string += '<div class="score-options-header">Calculating scores...</div>';
    html_string += '</div>'; // Lobby container
    
    var container_div = $('#task-container');
    container_div.html(html_string);
}

WordSearchInterface.prototype.renderScoreScreen = function()
{
    var html_string = "";
    html_string += '<div id="lobby-container">';
    html_string += '<div class="lobby-title">Game Over!</div>';
    html_string += '<div class="score-options-header">Final Score:</div>';
    
    // Add the scores
    html_string += this.renderSidebox(this.grid)

    // Add the payment options
    html_string += '<div class="score-options-header">Select the most fair payment:</div>';
    html_string += '<div id="score-options-container">';

    var found_list = this.grid.getFoundList()
    var payment_options = this.score_calculator.generateRewardOptions(found_list)
    for(var i = 0; i < payment_options.length; i++)
    {
        var option_id = payment_options[i]['id']
        var payments = payment_options[i]['split']
        var option_html = this.renderScoreOption(option_id, i+1, payments);
        html_string += option_html;
    }
    html_string += '</div>'; // Options container

    // Add "next" button
    html_string += "<button type='button' id='submit-button' class='btn' disabled='true'>Next Puzzle</button>";
    html_string += '</div>'; // Lobby container
    
    var container_div = $('#task-container');
    container_div.html(html_string);

    this.initHandlersScoreScreen();
    this.updateSidebox();
}

// Render a single payment option for the score screen
// Store the option ID in the radio button field
WordSearchInterface.prototype.renderScoreOption = function(option_id, option_num, payments)
{
    // hack
    payments[0] = 1;
    payments[1] = 2;
    payments[2] = 10;
    var total = payments[0] + payments[1] + payments[2];
    if(total == 0)
    {
        // Hack: make things look okay
        var percentages = [33, 34, 33];
    }
    else
    {
        var percentages = [
            100 * payments[0] / total,
            100 * payments[1] / total,
            100 * payments[2] / total
        ];
    }
    
    var radio_input = "<input class='score-radio' type='radio' name='score-option' value='" + option_id + "'> Option " + option_num;
    var html_string = 
        "<div class='score-option-line'>" + 
        "<div class='score-option-button'>" +
        radio_input +
        "</div>" + 
        "<div class='score-option-chart'>";

    for(var p = 0; p < 3; p++)
    {
        var p_text = "";
        if(payments[p] > 0)
        {
            if(percentages[p] > 10)
                p_text = "P" + (p+1) + ": " + payments[p] + "";
            else
                p_text = payments[p];
        }
        var p_string = "<div class='score-option-p" + (p+1) + "' style='width:" + percentages[p] + "%'>" + p_text + "</div>";
        html_string += p_string;
    }
    html_string +=
        "</div>" +
        "</div>";

    return html_string;
}

// ----- Lobby screen updates
// Check if all players are ready
WordSearchInterface.prototype.checkAllReady = function()
{
    for(var i = 0; i < 3; i++)
    {
        if(this.player_status[i] != 1)
            return false;
    }
    
    return true;
}

// All players are ready, so start a countdown
WordSearchInterface.prototype.startCountdown = function()
{
    // If we're already counting down, do nothing
    if(this.countdown_timer.running)
        return;
    
    // Start the timer
    this.countdown_timer.startTimer();
    
    // Update the screen repeatedly
    this.updateCountdown();
    
    // Alert user that the game is starting soon
    var seconds = Math.ceil(this.countdown_length / 1000);
    //alert("Game starting in " + seconds + " seconds");
    
    // TODO: send message to keep everyone synced
    // (Might not be necessary)
}

WordSearchInterface.prototype.updateCountdown = function()
{
    // Find how long we have left
    var time_elapsed = this.countdown_timer.getTime();
    var time_left = this.countdown_length - time_elapsed;
    
    // If we're done, start the game
    if(time_left <= 0)
    {
        this.startGame();
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

// Update the scores and words in the sidebox
WordSearchInterface.prototype.updateSidebox = function()
{
    // Get a list of all found words
    var found_list = this.grid.getFoundList();

    // Update whether or not we've found the words
    for(var i = 0; i < found_list.length; i++)
    {
        var word_id = "word-" + i;
        $('#' + word_id).toggleClass('word-found', found_list[i]);
    }

    // Find scores
    var scores = this.score_calculator.getAllScores(found_list);
    var score_lines = scores['scores'];
    var score_total = scores['total'];
    
    // Update scores
    for(var i = 0; i < score_lines.length; i++)
    {
        $("#score-" + i).text(score_lines[i]);
    }
    $("#score-total").text(score_total);
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
    this.updateSidebox();
    
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

// ----- Score screen
// Check if all players are done the game
WordSearchInterface.prototype.checkAllFinished = function()
{
    for(var i = 0; i < 3; i++)
    {
        if(this.player_status[i] != 2)
            return false;
    }
    
    return true;
}

// ----- Handlers
WordSearchInterface.prototype.initHandlersLobby = function()
{
    var that = this;
    $('#lobby-button').click(function(e) {
        // Change this.ready and send message
        if(that.player_status[that.player_id] == 1)
            that.setStatus(0);
        else
            that.setStatus(1);
        
        
        // Move this code into an end-of-countdown
        //that.callback();
        
        // Make a response so we can track start time
        // TODO: bring this back if we're going to measure time
        //that.client.create('response', {}, function(res){});
    });
    
    $("#debug-button").click(function(e) {
        that.getNextTask();
//        that.startCountdown();
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

WordSearchInterface.prototype.initHandlersScoreScreen = function()
{
    that = this;

    // Enable submit button after selecting an option
    $(".score-radio").each(function(){
        $(this).on("change", function(){
            $("#submit-button").removeAttr("disabled");
        })
    });

    // Test: does button work when disabled?
    $("#submit-button").click(function(){
        console.log("Clicked submit");
    });
}






module.exports = WordSearchInterface;