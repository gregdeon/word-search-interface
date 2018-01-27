var $ = require('jquery');
var ReconnectingWebSocket = require('./reconnecting-websocket-min');
var CrowdCurioClient = require('crowdcurio-client')

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

function WordSearchInterface() 
{
    this.grid = null;
    
    this.selecting = false;
    this.select_x1 = 0;
    this.select_y1 = 0;
    this.select_x2 = 0;
    this.select_y2 = 0;

    var ws_scheme = window.location.protocol == "https:" ? "wss" : "ws";
    // TODO: re-add websocket
    // this.websock = new ReconnectingWebSocket(ws_scheme + '://' + window.location.host + "/ws/");


    this.client = new CrowdCurioClient();
    this.client.init({
        user: global.user,
        task: global.task,
        experiment: global.experiment,
        condition: global.condition
    });

    this.client.task_session.setListeners({
        "receive": this.handleNotification.bind(this)
    });
}

WordSearchInterface.prototype.initialize = function(config)
{
    var that = this;
    this.client.getNextTask('', function(task) {
        var letter_list = task.content.letter_list;
        var word_list = task.content.word_list;
        that.grid = new WordSearchGrid(letter_list, word_list);
        that.render();
        that.initHandlers();
        that.updateFoundWords();
    });
}

WordSearchInterface.prototype.render = function()
{   
    var container_div = $('#task-container');
    
    // Build word search grid
    var html_string = "<div id='word-search-game'>";
    html_string += "<div class='word-search-grid'>";
    for(var iy = 0; iy < this.grid.size_y; iy++)
    {
        html_string += "<div class='word-search-line'>";
        for(var ix = 0; ix < this.grid.size_x; ix++)
        {
            var id_string = 'id=box-x' + ix + '-y' + iy;
            html_string += "<div " + id_string + " class='word-search-letter'>";
            html_string += this.grid.letters[iy][ix];
            html_string += "</div>";
        }
        html_string += "</div>";
    }
    html_string += "</div>"

    html_string += this.renderWords(this.grid)
/*
    html_string += "<div class='word-search-wordlist'>"
    html_string += "<b>Word List</b>"
    for(var i = 0; i < this.grid.words.length; i++)
    {
        var id_string = "id=word-" + i;
        html_string += "<div " + id_string + " class='word-search-word'>";
        html_string += this.grid.getWord(i);
        html_string += "</div>";
        
    }
    html_string += "</div>"
*/
    html_string += "</div>"

    html_string += "<br> <button type='button' id='reset-button'>Reset Puzzle</button>";

    container_div.html(html_string);
}

// Returns an HTML string with the word lists
WordSearchInterface.prototype.renderWords = function(grid)
{
    var player_list = [];
    var html_strings = {};

    for(var i = 0; i < grid.words.length; i++)
    {
        var player = grid.words[i].player;
        console.log(player);

        // Check if we already have an item for this player
        if(player_list.indexOf(player) == -1)
        {
            // Not in list yet -- start a new word list
            player_list.push(player);
            html_strings[player] = "";
        }

        // Add this word to this player's list
        var id_string = "id=word-" + i;
        html_strings[player] += "<div " + id_string + " class='word-search-word'>";
        html_strings[player] += this.grid.getWord(i);
        html_strings[player] += "</div>";
    }

    // Wrap all the word lists in their divs and return
    var ret = "";
    player_list.sort();
    for(var i = 0; i < player_list.length; i++)
    {
        var player = player_list[i];
        ret += "<div class='word-search-wordlist'>";
        ret += "<b>Player " + player + "</b>";
        ret += html_strings[player];
        ret += "</div>";
    }

    return ret;
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

/*
WordSearchInterface.prototype.updateWordList = function()
{
    html_string = "<b>Word List</b>"
    for(var i in this.grid.words)
    {
        var id_string = "id=word-" + i;
        html_string += "<div " + id_string + " class='word-search-word'>";
        html_string += this.grid.getWord(i);
        html_string += "</div>";
        
    }
    $('.word-search-wordlist').html(html_string);
}
*/

WordSearchInterface.prototype.updateFoundWords = function()
{
    console.log('getting words from client')
    console.log(this);
    that = this;
    this.client.listAll('response', {}, function(res){
        for(var i = 0; i < res.length; i++)
        {
            that.grid.updateWord(res[i].content)
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
    });
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

WordSearchInterface.prototype.findWord = function(word_num)
{
    // When we find a word, tell the server that we found it
    /*
    var message = 
    {
        "message": "found_word",
        "word_id": word_num
    }*/

    var resp = {
        'word_id': word_num,
        'found': true
    }
    that = this;
    this.client.create('response', {'content': resp}, function(res){
        that.notifyAboutUpdate();
    });

    // TODO: move this into websocket receiver function


    // TODO: re-add
    // this.websock.send(JSON.stringify(message));
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

WordSearchInterface.prototype.initHandlers = function()
{
    console.log("Initializing handlers...");
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
        var message = 
        {
            "message": "reset_puzzle",
        }

        that.client.listAll('response', {}, function(res){
            for(var i = 0; i < res.length; i++)
            {
                that.client.delete('response', {'id': res[i].id}, function(res) {
                    that.updateFoundWords();
                });
            }

        });

        //that.client.task_session.send(message);
        // TODO: re-add
        //that.websock.send(JSON.stringify(message));
    });
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