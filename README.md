Google App Script files to log chess account data

Archive Sheet
id (order of archives from oldest to newest)
archive url
name YYYY-MM
month
year
etag
Meta data listing archive info like game count, games written to sheet. Timestamps of last time I checked the archive etag to see if it changed last seen url (to be used as pointer) 



Fetch Archives
Fetches archive list and puts it in archive sheet as row per archive

Update Archives
Uses etags to check if archive list changed and if so appends new archive(s) to bottom

Check Changed Archives
Uses etag and caching to see what archives from the list have been modified

Check New Games
using last seen URL in the game archive as a pointer check how many games were added archive
(Using etag first, if archive not changed then no new games would exist, this is different then check changed archives at it should be quicker and not check every url in the sheet for changes but just look for new games)

Allow mode to rebuild some meta data like last seen and such for maintenance so I can clear it then update an archive and fully check it. 

Establish Archive Activity
If the timestamp of last time an archive was checked for changes is greater than the end of month of the month and year of the archive then it is established as Inactive Archive (still can be checked for changes and or new games but used for grouping so I can only run functions towards active archives as well)

List all data for archive as columns in archive sheet including last modified last checked (for changes) last checked for new games, amount of games. 

Include Functionality that fetches games from archives and writes them to master sheet of tab Games, this sheet would have a comprehensive list of games as a row that flattens the json of the game but changes fields like switching white vs black objects to Idenity fields my.username my.rating my.result etc instead of white.username white.rating if I’m white and opponent.username and opponent.rating as examples. Would need my.color then to establish if I’m white or black. Include archive as a header that shows the archive name (YYYY-MM). Accuracies would be split into identity group too my.accuracy opponent.accuracy. Include a column for game_type for live or daily based on the time class, if time class is daily then game_type is daily if time class is not then game_type is live. Include column for format that takes rules_{time_class} like chess_blitz or chess_daily. (If rules do not equal chess meaning the game was a variant then format is rules_{game_type} as they use broader type as categorization for timing. Format is used for ratings as I have a unique rating for each format. Parse through the pgn headers of pgn field. Make sure every date and date time is converted to True date objects for sheets. Make sure also every time is converted to my timezone based on sheet settings. I don’t want every pgn header in games sheet but I do want the exact date times of start and end of game from pgn as the flattened json start time value is null for live games but shows in pgn. So I just want to see one value for start and one for end showing the date time of both values. Add a duration column too that shows duration as a time object too. Show pgn eco and ecourl too in games sheet. I will run fetch based on settings i input in a separate sheet like specific range of archives to act on by date or by id, or fetch active archives or act on all archives. Mode: just check for new games using last seen game and add it to sheet or check entire archive for changes or additions, update changes games and add new ones using url as anchor. Make sure this this fetch batch appends set values writes
Make sure there is fast existence checks in memory url to row index index. Include fixed headers for better performance. Include comprehensive logging of every function call and all data occurring. Make sure there are no duplicates when I check archives or games in my sheet append mode should only add new game urls to the sheet and update mode should check for updated games from each archive and update them as well as add new games from that archive. Sheet should always have games ordered newest on top and oldest on bottom of sheet so when you batch act do it so you check oldest archive first and write them batch style in reverse order of the object list so newest game of that archive is on top then when you do next month do same thing but append that month above data. Include another column per game named callback_url it will be then add all callback headers too from callback data of the sheet. When I fetch games do not fill callback headers that will be a seperate function call. I will run a function that establishes a callback queue and checks rows in games sheets that have callback urls ready but have not been processed into headers successfully. Then a function to process a certain number of callbsck URLs into game sheet to add data for that game. 

https://chess.com/callback/live/game/121216238603

Based on the url of the game

https://www.chess.com/game/live/121216238603

If game/daily/ in url then callback/daily obviously


Include another sheet player stats that I can run a function on to fetch player stats of my account and log all the data and timestamp of fetch into a row when I run it again append new stat snapshot to the top. 

Convert callback url data into identity similar to fetching games too and add calculated columns that shows pregame rating for me and opponent by taking rating - rating change. 



Make sure you create universal constants when needed, I would like one function call to build sheets make sure you’re using caching and etags and make sure you’re logging everything on the sheet. Include another sheet in the project that lists every day from today to when my account was created or my first game. Then include total stats of games that finished in that date in my timezone, include for each format wins losses draws rating end of day, rating beginning of day, total duration of the format in seconds. This sheet will update via a function that checks stats in games sheet to fill data per date batch style. End of day rating takes last known my rating from game of that format meaning the game of that format with largest timestamp of end date time from games that is less than timestamp of end of day timestamp of that day. Same with beginning of day. Include rating change Idempotent: append-only won’t duplicate; update mode overwrites existing rows by url
For speed of fetching games Derived fields (computed in-memory)


https://www.chess.com/news/view/published-data-api

Source Info
List of Monthly Archives
Description: Array of monthly archives available for this player. URL pattern: https://api.chess.com/pub/player/{username}/games/archives
Data Format:
{
  "archives": [
    /* array of URLs for monthly archives in ascending chronological order */
  ]
}

JSON-LD contexts: https://api.chess.com/context/GameArchives.jsonld
Example: https://api.chess.com/pub/player/erik/games/archives


Source
Player Stats
Description: Get ratings, win/loss, and other stats about a player's game play, tactics, lessons and Puzzle Rush score. URL pattern: https://api.chess.com/pub/player/{username}/stats
The response contains many "stats objects," each identified by the ratings-type from the game, composed of the rules code, an underscore, and the time-class code. If a person has not played a particular game type, no stats object will be present for it. Like so:
{
  "chess_daily": {
    /* stats object for games of rules "chess" and "daily" time-class */
  },
  "chess960_daily": {
    /* stats object for games of rules "chess960" and "daily" time-class */
  },
  "chess_blitz": {
    /* stats object for games of rules "chess" and "blitz" time-class */
  },
  "tactics": {
      "highest": {
          "rating": "integer",
          "date": "timestamp"
      },
      "lowest": {
          "rating": "integer",
          "date": "timestamp"
      }
  },
  "lessons":{
      "highest": {
          "rating": "integer",
          "date": "timestamp"
      },
      "lowest": {
          "rating": "integer",
          "date": "timestamp"
      }
  },
  "puzzle_rush": {
      "daily":{ 
          "total_attempts": "integer",
          "score": "integer"
       },
      "best": {
          "total_attempts": "integer",
          "score": "integer"
       }
   }
}

Each stats object will contain only information that has been collected and is not "default". For example, if a player has not won any games in a game type, the "best" stats will not be present; if they have not played in tournaments, then the tournaments stats will not be present. Not all stats are collected for all game types, and the available data may change from time to time as we gather more information. Tactics, Lessons and Puzzle Rush stats may be missing, depending on player activity.
Data Format, each Game-Type:
{
  "last": { // the current stats
    "date": 1509709165, // timestamp of the last rated game finished
    "rating": 1642, // most-recent rating
    "rd": 58 // the Glicko "RD" value used to calculate ratings changes
  },
  "best": { // the best rating achieved by a win
    "date": 1256228875, // timestamp of the best-win game
    "rating": 2065, // highest rating achieved
    "game": "URL" // URL of the best-win game
  },
  "record": { // summary of all games played
    "win": 177,  // number of games won
    "loss": 124, // number of games lost
    "draw": 21,  // number of games drawn
    "time_per_move": 18799, // integer number of seconds per average move
    "timeout_percent": 9.99 // timeout percentage in the last 90 days
  },
  "tournament": { // summary of tournaments participated in
    "count": 20,   // number of tournaments joined
    "withdraw": 1, // number of tournaments withdrawn from
    "points": 39,  // total number of points earned in tournaments
    "highest_finish": 1 // best tournament place
  }
}

JSON-LD contexts: in progress Example: https://api.chess.com/pub/player/erik/stats


Source
Player Profile
Description: Get additional details about a player in a game. URL pattern: https://api.chess.com/pub/player/{username} Data format:
{
  "@id": "URL", // the location of this profile (always self-referencing)
  "url": "URL", // the chess.com user's profile page (the username is displayed with the original letter case)
  "username": "string", // the username of this player
  "player_id": 41, // the non-changing Chess.com ID of this player
  "title": "string", // (optional) abbreviation of chess title, if any
  "status": "string", // account status: closed, closed:fair_play_violations, basic, premium, mod, staff
  "name": "string", // (optional) the personal first and last name
  "avatar": "URL", // (optional) URL of a 200x200 image
  "location": "string", // (optional) the city or location
  "country": "URL", // API location of this player's country's profile
  "joined": 1178556600, // timestamp of registration on Chess.com
  "last_online": 1500661803, // timestamp of the most recent login
  "followers": 17 // the number of players tracking this player's activity
  "is_streamer": "boolean", //if the member is a Chess.com streamer
  "twitch_url": "Twitch.tv URL",
  "fide": "integer" // FIDE rating
}


JSON-LD Context: https://api.chess.com/context/Player.jsonld Example: https://api.chess.com/pub/player/erik

Source Info
Complete Monthly Archives
Description: Array of Live and Daily Chess games that a player has finished. URL pattern: https://api.chess.com/pub/player/{username}/games/{YYYY}/{MM}
* "YYYY" is the four digit year of the game-end 
* "MM" is the two-digit month 
Data Format, each Game:
{
  "white": { // details of the white-piece player:
    "username": "string", // the username
    "rating": 1492, // the player's rating after the game finished
    "result": "string", // see "Game results codes" section
    "@id": "string" // URL of this player's profile
  },
  "black": { // details of the black-piece player:
    "username": "string", // the username
    "rating": 1942, // the player's rating after the game finished
    "result": "string", // see "Game results codes" section
    "@id": "string" // URL of this player's profile
  },
  "accuracies": { // player's accuracies, if they were previously calculated
    "white": float,
    "black": float
  },
  "url": "string", // URL of this game
  "fen": "string", // final FEN
  "pgn": "string", // final PGN
  "start_time": 1254438881, // timestamp of the game start (Daily Chess only)
  "end_time": 1254670734, // timestamp of the game end
  "time_control": "string", // PGN-compliant time control
  "rules": "string", // game variant information (e.g., "chess960")
  "eco": "string", //URL pointing to ECO opening (if available),
  "tournament": "string", //URL pointing to tournament (if available),  
  "match": "string", //URL pointing to team match (if available)  
}

JSON-LD contexts: https://api.chess.com/context/ChessGames.jsonld, https://api.chess.com/context/ChessGame.jsonld
Example: https://api.chess.com/pub/player/erik/games/2009/10

Callback isn’t api and doesn’t have detailed source but does have this Example
Link
 https://www.chess.com/callback/live/game/85305696

Output

{
  "game": {
    "canSendTrophy": false,
    "changesPlayersRating": 1,
    "colorOfWinner": "white",
    "id": 85305696,
    "uuid": "b0526f00-38a3-11dd-8000-000000010001",
    "initialSetup": "",
    "isLiveGame": true,
    "isAbortable": false,
    "isAnalyzable": true,
    "isCheckmate": false,
    "isStalemate": false,
    "isFinished": true,
    "isRated": true,
    "isResignable": false,
    "lastMove": "df",
    "moveList": "mC!TbsZJCJTJowJsjs7JdvJGfo5QgmQKvuKEuD0KDA9RpxETeg8!lBKCmDYQiq98cuGYBJRDuDY0JQTNDuXQuI0Tad6SAm46oC2UCoSJIBTRmlQIfeNwe868nwRwdf",
    "plyCount": 63,
    "ratingChangeWhite": 15,
    "ratingChangeBlack": -13,
    "gameEndReason": "timeout",
    "resultMessage": "erik won on time",
    "endTime": 1294451145,
    "turnColor": "black",
    "type": "chess",
    "typeName": "Standard Chess",
    "allowVacation": false,
    "pgnHeaders": {
      "Event": "Live Chess",
      "Site": "Chess.com",
      "Date": "2011.01.08",
      "White": "erik",
      "Black": "Checkisinthemail",
      "Result": "1-0",
      "ECO": "B02",
      "WhiteElo": 2022,
      "BlackElo": 2320,
      "TimeControl": "60",
      "EndTime": "1:45:45 GMT+0000",
      "Termination": "erik won on time",
      "SetUp": "1",
      "FEN": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    },
    "moveTimestamps": "600,600,566,586,550,577,545,557,544,549,520,530,505,522,495,512,472,481,458,469,421,381,401,368,392,348,385,312,364,298,333,287,322,230,258,204,245,184,233,177,217,149,207,131,194,121,169,97,156,76,143,70,130,50,116,40,97,38,89,20,85,4,59",
    "baseTime1": 600,
    "timeIncrement1": 0
  },
  "players": {
    "top": {
      "uuid": "b6b52850-1209-11e0-805f-000000000000",
      "isContentHidden": true,
      "id": 4461695,
      "isComputer": false,
      "avatarUrl": "https://www.chess.com/bundles/web/images/noavatar_l.84a92436.gif",
      "countryId": 2,
      "isEnabled": false,
      "canWinOnTime": false,
      "color": "black",
      "countryName": "United States",
      "defaultTab": 1,
      "hasMovedAtLeastOnce": true,
      "isDrawable": false,
      "isOnline": false,
      "isInLivechess": false,
      "isTouchMove": false,
      "isVacation": false,
      "isWhiteOnBottom": false,
      "lastLoginDate": 1300934266,
      "location": "",
      "membershipLevel": 10,
      "membershipCode": "basic",
      "memberSince": 1293489375,
      "postMoveAction": "next_game",
      "rating": 2320,
      "turnTimeRemaining": "Out of time",
      "username": "Checkisinthemail",
      "vacationRemaining": "13 days",
      "gamesInProgress": 0,
      "friendRequestSent": false,
      "friendRequestReceived": false,
      "isBlocked": false,
      "isFriend": false
    },
    "bottom": {
      "uuid": "fe696c00-fcba-11db-8029-000000000000",
      "isContentHidden": false,
      "id": 41,
      "isComputer": false,
      "avatarUrl": "https://images.chesscomfiles.com/uploads/v1/user/41.5434c4ff.100x100o.723c86cdd5ef.jpeg",
      "countryId": 2,
      "isEnabled": true,
      "canWinOnTime": false,
      "color": "white",
      "countryName": "United States",
      "defaultTab": 1,
      "hasMovedAtLeastOnce": true,
      "isDrawable": false,
      "isOnline": false,
      "isInLivechess": false,
      "isTouchMove": false,
      "isVacation": false,
      "isWhiteOnBottom": false,
      "lastLoginDate": 1757976275,
      "location": "Bay Area, CA",
      "membershipLevel": 90,
      "membershipCode": "staff",
      "memberSince": 1178556600,
      "postMoveAction": "next_game",
      "rating": 2022,
      "turnTimeRemaining": "0 days",
      "flair": {
        "id": "ac1542ae-2af1-11ee-91ea-6bcbe8902496",
        "images": {
          "png": "https://images.chesscomfiles.com/chess-flair/staff_mod_account/pawn_traditional.png",
          "svg": "https://images.chesscomfiles.com/chess-flair/staff_mod_account/pawn_traditional.svg",
          "lottie": "https://images.chesscomfiles.com/chess-flair/staff_mod_account/pawn_traditional.lottie"
        }
      },
      "username": "erik",
      "vacationRemaining": "8 weeks",
      "gamesInProgress": 7,
      "friendRequestSent": false,
      "friendRequestReceived": false,
      "isBlocked": false,
      "isFriend": false
    }
  }
}

Before writing code understand what im asking and suggest improvements or ask clarifying questions or tell me how to improve my response
