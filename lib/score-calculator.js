// scoring.js
// Functions for calculating game score and reward splits

// Scoring class
function ScoreCalculator()
{
    // Per-line score options
    // Flat
    //this.per_line_scores = [0, 2, 4, 6];
    // Superadditive
    this.per_line_scores = [0, 1, 3, 6];
    // Subadditive
    //this.per_line_scores = [0, 3, 6, 6];
}

// Find per-line and total scores
// Assume 3 players with equal number of words
// Also assume word order is all P1 words, then P2, then P3
ScoreCalculator.prototype.getAllScores = function(found_list)
{
    var words_per_player = found_list.length / 3;
    var score_per_line = [];
    var found_per_line = [];
    var score_total = 0;
    for(var i = 0; i < words_per_player; i++)
    {
        var found_line = 0;
        found_line += found_list[i + 0*words_per_player];
        found_line += found_list[i + 1*words_per_player];
        found_line += found_list[i + 2*words_per_player];
        
        var score_line = this.per_line_scores[found_line];
        
        found_per_line.push(found_line);
        score_per_line.push(score_line);
        score_total += score_line;
    }
    
    var ret = {
        'scores': score_per_line,
        'found': found_per_line,
        'total': score_total
    };
    return ret;
}

// ----- Base split functions
// Get an equally split reward
ScoreCalculator.prototype.equalSplit = function(found_list)
{
    // Get total
    var total = this.getAllScores(found_list)['total'];
    
    // Split: just divide equally
    var per_player = total / 3;
    var ret = [per_player, per_player, per_player];
    return ret;
}

// Proportional: split relative to number of words found
ScoreCalculator.prototype.proportionalSplit = function(found_list)
{
    // Get total
    var total = this.getAllScores(found_list)['total'];
    
    // Find each player's number of words
    var words_per_player = found_list.length / 3;
    var found = [0, 0, 0];
    var found_total = 0;
    
    for(var i = 0; i < words_per_player; i++)
    {
        for(var j = 0; j < 3; j++)
        {
            if(found_list[i + j*words_per_player])
            {
                found[j] += 1;
                found_total += 1;
            }
        }
    }
    
    // Split equally if nobody found anything
    if(found_total == 0)
    {
        return this.equalSplit(found_list);
    }
    
    // Otherwise, split proportionally
    var ret = [];
    for(var i = 0; i < 3; i++)
    {
        ret.push(total * found[i] / found_total);
    }
    return ret;
    
}

// Winner-biased: split 50/30/20
// TODO

// Shapley values
ScoreCalculator.prototype.shapleySplit = function(found_list)
{
    // Calculate scores
    var scores = this.getAllScores(found_list);
    var score_list = scores['scores']
    var found = scores['found']
    
    // Find number of lines to consider
    var words_per_player = found_list.length / 3;
    
    // Build individual shares
    var ret = [0, 0, 0];
    for(var i = 0; i < words_per_player; i++)
    {
        for(var j = 0; j < 3; j++)
        {
            if(found_list[i + j*words_per_player])
            {
                ret[j] += score_list[i] / found[i];
            }
        }
    }
    return ret;
}

// ----- Split adjustment functions
// Round down
ScoreCalculator.prototype.roundDown = function(split)
{
    var ret = [];
    for(var i = 0; i < split.length; i++)
    {
        ret.push(Math.floor(split[i]));
    }
    return ret;
}

// Naively shift some reward between the players
// Make sure that diff sums to 0 and is same length as split
// ex: adjustSplitNaive(split, [2, -1, -1])
ScoreCalculator.prototype.adjustSplitNaive = function(split, diff)
{
    var ret = [];
    for(var i = 0; i < split.length; i++)
    {
        ret.push(split[i] + diff[i]);
    }
    return ret;
}

// Carefully shift reward between players
// Avoids making rewards negative
// Moves up to pts points from everyone to player 
ScoreCalculator.prototype.adjustSplit = function(split, player, pts)
{
    // Copy
    var ret = [];
    for(var i = 0; i < split.length; i++)
    {
        ret.push(split[i]);
    }
    
    // Adjust
    for(var i = 0; i < split.length; i++)
    {
        // Avoid negative reward
        if(ret[i] < pts)
        {
            var actual_pts = ret[i];
            ret[i] -= actual_pts;
            ret[player] += actual_pts;
        }
        else
        {
            ret[i] -= pts;
            ret[player] += pts;
        }
    }
    return ret;
}

// ----- Build list of reward options
// Helper: check if two options are equal
ScoreCalculator.prototype.checkEqual = function(split_1, split_2)
{
    for(var i = 0; i < split_1.length; i++)
    {
        if(split_1[i] != split_2[i])
            return false;
    }
    return true;
}

ScoreCalculator.prototype.generateRewardOptions = function(found_list)
{
    // Find base options
    // TODO: break this out into a separate function and select function based 
    //       on experiment condition
    var options = [
    {'id': 1, 'split': this.roundDown(this.proportionalSplit(found_list))},
    {'id': 2, 'split': this.roundDown(this.adjustSplit(this.proportionalSplit(found_list), 0, 1))},
    {'id': 3, 'split': this.roundDown(this.adjustSplit(this.proportionalSplit(found_list), 1, 1))},
    {'id': 4, 'split': this.roundDown(this.adjustSplit(this.proportionalSplit(found_list), 2, 1))},
    ];
    
    // Check for duplicates
    // (Remove at end)
    var remove = [];
    for(var i = 0; i < options.length; i++)
    {
        remove.push(false);
        for(var j = 0; j < i; j++)
        {
            if(this.checkEqual(options[i]['split'], options[j]['split']))
            {
                remove[i] = true;
            }
        }
    }
    
    // Remove duplicates
    for(var i = 0; i < options.length; i++)
    {
        if(remove[i])
        {
            options.splice(i, 1);
            remove.splice(i, 1);
            i -= 1;
        }
    }
    
    // Scramble
    // TODO
    
    return options
}


// Test functions
var found_list = [];
for(var i = 0; i < 30; i++)
{
    found_list.push(false);
}
found_list[ 0] = true;
found_list[ 1] = true;
found_list[ 2] = true;
found_list[ 3] = true;
found_list[ 4] = true;
found_list[ 5] = true;
found_list[ 6] = true;
found_list[10] = true;
found_list[11] = true;
found_list[12] = true;
found_list[13] = true;
found_list[20] = true;
found_list[21] = true;
found_list[22] = true;

var sc = new ScoreCalculator();

function testSplits(found_list)
{    
    //console.log(found_list)
    var scores = sc.getAllScores(found_list);
    console.log(scores);

    var equal = sc.equalSplit(found_list);
    console.log(equal)
    var prop = sc.proportionalSplit(found_list);
    console.log(prop)
    var shapley = sc.shapleySplit(found_list);
    console.log(shapley)
    var adj = sc.adjustSplit(equal, 0, 1);
    console.log(adj)
}

testSplits(found_list)

var options = sc.generateRewardOptions(found_list);
console.log(options);

module.exports = ScoreCalculator;