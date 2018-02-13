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

function WordSearchInterface() 
{
    // Number of players in the game
    // TODO: use this everywhere
    this.num_players = 3;

    // current screen: lobby, game, or score
    this.mode = null;

    // Puzzle data for game - mainly loaded from Data object
    this.grid = null;
    
    // Game state
    this.timer = new Timer();
    this.selecting = false;
    this.select_x1 = 0;
    this.select_y1 = 0;
    this.select_x2 = 0;
    this.select_y2 = 0;
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
        that.postInitialize();
    });

    this.client.task_session.setListeners({
        "save": this.handleNotification.bind(this),
        "delete": this.handleNotification.bind(this)
    });
}

WordSearchInterface.prototype.postInitialize = function(config)
{
    this.getNextTask();
}

WordSearchInterface.prototype.render = function()
{
    var functions = {
        // TODO: this is a temporary change for 1-player mode
        "lobby": this.renderLobby1P,
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

WordSearchInterface.prototype.renderLobby1P = function()
{
    // Set up the HTML structure of the lobby

    // Build HTML
    var html_string = "";
    html_string += '<div id="lobby-container">';
    html_string += '<div class="lobby-title">Ready To Start</div>';

    html_string += '<div class="lobby-buttons">'
    html_string += '<button type="button" class="btn" id="lobby-button">Start Puzzle</button>'
    html_string += '</div>'
    html_string += '</div>'

    var container_div = $('#task-container');
    container_div.html(html_string);

    this.initHandlersLobby();
}

WordSearchInterface.prototype.renderLobby = function()
{
    // Set up the HTML structure of the lobby

    // Build HTML
    var html_string = "";
    html_string += '<div id="lobby-container">';
    html_string += '<div class="lobby-title"></div>';

    // Make one status bar for each player
    for(var i = 0; i < 3; i++)
    {
        html_string += '<div class="lobby-line-p' + (i+1) + '">';
        html_string += '<div class="lobby-player"></div>';
        html_string += '<div class="lobby-ready"></div>';
        html_string += '</div>';
    }

    html_string += '<div class="lobby-buttons">'
    html_string += '<button type="button" class="btn" id="lobby-button">Start Puzzle</button>'
    html_string += '</div>'
    html_string += '</div>'

    var container_div = $('#task-container');
    container_div.html(html_string);

    this.initHandlersLobby();

    this.updateLobby();
}

WordSearchInterface.prototype.updateLobby = function()
{
    // TODO: hook this function into WS messages (type = 6: updated presence info)

    // Update the dynamic strings in the lobby
    // NOTE: these are hard-coded for 3-player games
    var title_string = "Waiting for players..."

    var player_strings = [
        "Player 1",
        "Player 2",
        "Player 3",
    ]

    var status_strings = [
        "Not Ready",
        "Not Ready",
        "Not Ready",
    ]

    // TODO: get list of active members
    var task_session_id = this.client.task_session.task_session;
    var self_user_id = this.client.user.id;
    console.log(this.client.task_session.connected_users);

    this.client.listAll('tasksessionmember', {'task_session': task_session_id}, function(res){
        for(var i = 0; i < res.length; i++)
        {
            if(i > 3)
                break;

            status_strings[i] = "Ready";
            var user_id = res[i].user.id;

            if(user_id == self_user_id)
                player_strings[i] += " (you)"
        }    

        $(".lobby-title").text(title_string);
        for(var i = 0; i < 3; i++)
        {
            $(".lobby-line-p" + (i+1) + " > .lobby-player").text(player_strings[i]);
            $(".lobby-line-p" + (i+1) + " > .lobby-ready").text(status_strings[i]);
        }
    });


}

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
        "<b>Puzzle: </b> <div id='sidebox-puzzle-num'>1</div>",
        "<b>Player: </b> <div id='sidebox-player-num'>2</div>",
        "<b>Time: </b> <div id='sidebox-time'>120</div>"
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

WordSearchInterface.prototype.renderScoreScreen = function()
{
    // TODO
}

WordSearchInterface.prototype.getXYFromId = function(id)
{
    var id_split = id.split("-");
    var ix = parseInt(id_split[1].slice(1));
    var iy = parseInt(id_split[2].slice(1));
    return [ix, iy];
}

WordSearchInterface.prototype.getIdFromXY = function(x, y)
{
    return "box-x" + x + "-y" + y
}

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

WordSearchInterface.prototype.setFound = function(x, y, found, player)
{
    this.setClass(x, y, "letter-found-p" + player, found);
}

WordSearchInterface.prototype.setSelected = function(x, y, selected)
{
    // values of selected:
    // true/false: set selected
    // null: toggle
    this.setClass(x, y, "letter-selected", selected);
}

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
    /*
    .then(function(){
        console.log("OK");
        that.updateScores();
    });
    */
}

WordSearchInterface.prototype.updateHighlighting = function()
{
    var dx = this.select_x2 - this.select_x1;
    var dy = this.select_y2 - this.select_y1;
    var len2 = dx*dx + dy*dy;
    
    for(var iy = 0; iy < this.grid.size_y; iy++)
    {
        for(var ix = 0; ix < this.grid.size_x; ix++)
        {
            if(!this.selecting)
            {
                this.setSelected(ix, iy, false);
            }
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

WordSearchInterface.prototype.updateScores = function()
{
    // Do something after the sleep!
    // Update the scores in the sidebox
    var scores = this.grid.getScoreAllLines()
    var total_score = 0;
    for(var i = 0; i < scores.length; i++)
    {
        $("#score-" + i).text(scores[i]);
        total_score += scores[i];
    }

    $("#score-total").text(total_score);
}

WordSearchInterface.prototype.findWord = function(word_num)
{
    var resp = {
        'word_id': word_num,
        'found': true
    }

    var data = {
        'position': word_num,
        'label': "true"
    }
    that = this;
    this.client.create('annotation', data, function(res){
        that.notifyAboutUpdate();
    });
}

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

WordSearchInterface.prototype.confirmSelection = function()
{
    var word_num = this.grid.checkIsWord(
        this.select_x1, 
        this.select_y1, 
        this.select_x2, 
        this.select_y2
    );
    
    if(word_num >= 0)
    {
        this.findWord(word_num);
    }
}

WordSearchInterface.prototype.initHandlersGame = function()
{
    console.log("Initializing game handlers...");
    that = this;
    // Add mouse click handlers to grid
    $('.word-search-letter').click(function(e) {
        var position = that.getXYFromId(e.target.id);
        var p_x = position[0]
        var p_y = position[1]
        
        if(!that.selecting)
        {
            that.selecting = true;
            that.select_x1 = p_x;
            that.select_y1 = p_y;
            that.select_x2 = p_x;
            that.select_y2 = p_y;
        }
        else
        {
            that.confirmSelection();
            that.selecting = false;
        }
        
        that.updateHighlighting();
    });
    
    $('.word-search-letter').mouseover(function(e) {
        var position = that.getXYFromId(e.target.id);
        var p_x = position[0]
        var p_y = position[1]
        
        if(that.selecting)
        {
            that.updateSelection(p_x, p_y);
        }
        
        that.updateHighlighting();
    });
    
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

// Lobby things
WordSearchInterface.prototype.initHandlersLobby = function()
{
    var that = this;
    $('#lobby-button').click(function(e) {
        // TODO: change this to a Ready status toggler
        // Move this code into an end-of-countdown
        that.startGame();

        // Make a response so we can track start time
        // TODO: bring this back if we're going to measure time
        that.client.create('response', {}, function(res){});
    });
}

WordSearchInterface.prototype.startGame = function()
{
    // DEBUG
    /*
    this.mode = "score";
    this.render();
    return;
    */

    this.mode = "game";
    this.render();
    this.updateFoundWords();

    // Start the timer and make it update often
    this.timer.startTimer();
    setInterval(this.updateTimer.bind(this), 200);
}


// Websocket things
// Notify all of the other interfaces about a change to the words
WordSearchInterface.prototype.notifyAboutUpdate = function()
{
    var message = 
    {
        "message": "words_updated"
    };


    this.client.task_session.send(message);
}

WordSearchInterface.prototype.handleNotification = function(event)
{
    console.log("received notification");
    this.updateFoundWords();
}

module.exports = WordSearchInterface;