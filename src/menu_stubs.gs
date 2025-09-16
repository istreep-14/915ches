// Stubs for functions referenced by the menu; to be implemented in later phases

function fetchAndWriteGames() {
	var settings = U.readSettings();
	var username = String(settings.username || '').trim();
	if (!username) {
		LOG.error('games', 'fetchAndWriteGames', '', 'Missing username in Settings');
		throw new Error('Please set username in Settings sheet.');
	}
	var mode = String(settings.mode || 'append_only');
	var maxGames = Number(settings.max_games_per_run || '500');
	var maxArchives = Number(settings.max_archives_per_run || '50');
	var rollupMode = String(settings.rollup_on_fetch || 'none');
	LOG.info('games', 'fetchAndWriteGames:start', '', 'Starting', { mode: mode, maxGames: maxGames, maxArchives: maxArchives });

	var archivesSheet = U.getOrCreateSheet(CONST.SHEET.ARCHIVES);
	U.ensureHeaders(archivesSheet, CONST.ARCHIVES_HEADERS);
	var ah = U.getHeaderIndexMap(archivesSheet);
	var lastRowA = archivesSheet.getLastRow();
	if (lastRowA < 2) {
		LOG.info('games', 'fetchAndWriteGames', '', 'No archives');
		return;
	}
	var archiveRows = archivesSheet.getRange(2, 1, lastRowA - 1, CONST.ARCHIVES_HEADERS.length).getValues();
	var indices = (typeof scopeArchiveRowIndices === 'function') ? scopeArchiveRowIndices(archiveRows, ah, settings) : archiveRows.map(function(_, i){ return i; });

	var gamesSheet = U.getOrCreateSheet(CONST.SHEET.GAMES);
	U.ensureHeaders(gamesSheet, CONST.GAMES_HEADERS);
	var gh = U.getHeaderIndexMap(gamesSheet);
	var lastRowG = gamesSheet.getLastRow();
	var urlToRow = {};
	if (lastRowG >= 2) {
		var urls = gamesSheet.getRange(2, gh['url'], lastRowG - 1, 1).getValues();
		for (var i = 0; i < urls.length; i++) {
			var u = String(urls[i][0] || '');
			if (u) urlToRow[u] = i + 2;
		}
	}

	var totalNewOrUpdated = 0;
	var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
	var affectedDates = {};
	// Process archives from oldest to newest; within each, oldest to newest, then insert-at-top reversed
	for (var idx = 0; idx < indices.length; idx++) {
		if (totalNewOrUpdated >= maxGames) break;
		var ai = indices[idx];
		var arow = archiveRows[ai];
		var archiveUrl = String(arow[ah['archive_url'] - 1] || '');
		var archiveId = arow[ah['id'] - 1];
		var archiveName = String(arow[ah['archive_name'] - 1] || '');
		if (!archiveUrl) continue;
		var resp = HTTP.fetchWithEtag(archiveUrl, '');
		if (!(resp.status >= 200 && resp.status < 300) || !resp.json) {
			LOG.warn('games', 'fetchArchive', archiveUrl, 'HTTP ' + resp.status);
			continue;
		}
		var games = Array.isArray(resp.json.games) ? resp.json.games : [];
		// Sort by end_time ascending for determinism
		games.sort(function(a, b){
			var ea = Number((a && a.end_time) || 0);
			var eb = Number((b && b.end_time) || 0);
			return ea - eb;
		});

		var newRows = [];
		var updates = [];
		var latestUrl = '';
		var latestEnd = 0;
		for (var g = 0; g < games.length; g++) {
			if (totalNewOrUpdated >= maxGames) break;
			var game = games[g];
			var gameUrl = String(game.url || '');
			if (!gameUrl) continue;
			var isExisting = !!urlToRow[gameUrl];
			var mapped = mapGameToRow(game, username, archiveId, archiveName, archiveUrl, gh);
			if (!isExisting) {
				if (mode === 'append_only' || mode === 'update') {
					newRows.push(mapped);
					totalNewOrUpdated++;
				}
			} else if (mode === 'update') {
				updates.push({ row: urlToRow[gameUrl], data: mapped });
				totalNewOrUpdated++;
			}
			// Track affected date by end_dt in sheet TZ
			var endCell = mapped[gh['end_dt'] - 1];
			if (endCell && endCell instanceof Date) {
				var dstr = Utilities.formatDate(endCell, tz, 'yyyy-MM-dd');
				affectedDates[dstr] = true;
			}
			var endTs = Number(game.end_time || 0);
			if (endTs >= latestEnd) {
				latestEnd = endTs;
				latestUrl = gameUrl;
			}
		}

		// Apply updates in place (batch by contiguous ranges if desired; simple loop for clarity)
		for (var u = 0; u < updates.length; u++) {
			gamesSheet.getRange(updates[u].row, 1, 1, CONST.GAMES_HEADERS.length).setValues([updates[u].data]);
		}

		// Insert-at-top for new rows: write in reverse order so newest ends up higher
		if (newRows.length) {
			gamesSheet.insertRows(2, newRows.length);
			var reversed = [];
			for (var r = newRows.length - 1; r >= 0; r--) reversed.push(newRows[r]);
			gamesSheet.getRange(2, 1, reversed.length, CONST.GAMES_HEADERS.length).setValues(reversed);
			// Update urlToRow map by shifting existing rows; rebuild is simplest
			lastRowG = gamesSheet.getLastRow();
			urlToRow = {};
			if (lastRowG >= 2) {
				var urls2 = gamesSheet.getRange(2, gh['url'], lastRowG - 1, 1).getValues();
				for (var j = 0; j < urls2.length; j++) {
					var uu = String(urls2[j][0] || '');
					if (uu) urlToRow[uu] = j + 2;
				}
			}
		}

		// Update archive metadata
		if (latestUrl) {
			arow[ah['last_seen_url'] - 1] = latestUrl;
		}
		arow[ah['game_count'] - 1] = games.length;
		arow[ah['updated_ts'] - 1] = U.now();
		archiveRows[ai] = arow;
		archivesSheet.getRange(ai + 2, 1, 1, CONST.ARCHIVES_HEADERS.length).setValues([arow]);
		if (totalNewOrUpdated >= maxGames) break;
	}

	// Optional incremental rollup
	if (rollupMode === 'incremental') {
		var dates = Object.keys(affectedDates);
		if (dates.length && typeof dailyRollupIncremental === 'function') {
			try {
				dailyRollupIncremental(dates);
			} catch (e) {
				LOG.warn('rollup', 'incremental', '', 'Error in incremental rollup: ' + (e && e.message));
			}
		}
	}

	LOG.info('games', 'fetchAndWriteGames:end', '', 'Completed', { total: totalNewOrUpdated });
}

function mapGameToRow(game, username, archiveId, archiveName, archiveUrl, gh) {
	var white = game.white || {};
	var black = game.black || {};
	var meIsWhite = String(white.username || '').toLowerCase() === username.toLowerCase();
	var me = meIsWhite ? white : black;
	var opp = meIsWhite ? black : white;
	var myColor = meIsWhite ? 'white' : 'black';
	var acc = game.accuracies || {};
	var myAcc = meIsWhite ? acc.white : acc.black;
	var oppAcc = meIsWhite ? acc.black : acc.white;
	var timeClass = String(game.time_class || (game.start_time ? 'daily' : 'blitz'));
	var gameType = (timeClass === 'daily') ? 'daily' : 'live';
	var rules = String(game.rules || 'chess');
	var format = (rules === 'chess') ? ('chess_' + timeClass) : (rules + '_' + gameType);
	var pgn = String(game.pgn || '');
	var pgnInfo = parsePgnHeadersAndMoves(pgn);
	var startDt = game.start_time ? U.toSheetDate(game.start_time) : (pgnInfo.startDate || '');
	var endDt = game.end_time ? U.toSheetDate(game.end_time) : (pgnInfo.endDate || '');
	var durationSeconds = (startDt && endDt && startDt instanceof Date && endDt instanceof Date) ? Math.max(0, Math.round((endDt.getTime() - startDt.getTime()) / 1000)) : '';
	var ecoCode = pgnInfo.ecoCode || '';
	var ecoUrl = pgnInfo.ecoUrl || (String(game.eco || '').startsWith('http') ? String(game.eco) : '');
	var callbackUrl = deriveCallbackUrl(String(game.url || ''), gameType);

	var row = new Array(CONST.GAMES_HEADERS.length);
	row[gh['archive_id'] - 1] = archiveId;
	row[gh['archive_name'] - 1] = archiveName;
	row[gh['archive_url'] - 1] = archiveUrl;
	row[gh['url'] - 1] = String(game.url || '');
	row[gh['callback_url'] - 1] = callbackUrl;
	row[gh['my.username'] - 1] = String(me.username || '');
	row[gh['my.id'] - 1] = '';
	row[gh['my.uuid'] - 1] = '';
	row[gh['my.color'] - 1] = myColor;
	row[gh['my.rating'] - 1] = Number(me.rating || '');
	row[gh['my.result'] - 1] = String(me.result || '');
	row[gh['my.accuracy'] - 1] = (myAcc != null && myAcc !== '') ? Number(myAcc) : '';
	row[gh['my.pregame_rating'] - 1] = '';
	row[gh['opponent.username'] - 1] = String(opp.username || '');
	row[gh['opponent.id'] - 1] = '';
	row[gh['opponent.uuid'] - 1] = '';
	row[gh['opponent.color'] - 1] = meIsWhite ? 'black' : 'white';
	row[gh['opponent.rating'] - 1] = Number(opp.rating || '');
	row[gh['opponent.result'] - 1] = String(opp.result || '');
	row[gh['opponent.accuracy'] - 1] = (oppAcc != null && oppAcc !== '') ? Number(oppAcc) : '';
	row[gh['opponent.pregame_rating'] - 1] = '';
	row[gh['is_rated'] - 1] = String(game.rated || game.is_rated || '') || '';
	row[gh['time_class'] - 1] = timeClass;
	row[gh['game_type'] - 1] = gameType;
	row[gh['rules'] - 1] = rules;
	row[gh['format'] - 1] = format;
	row[gh['time_control'] - 1] = String(game.time_control || '');
	row[gh['start_dt'] - 1] = startDt || '';
	row[gh['end_dt'] - 1] = endDt || '';
	row[gh['duration'] - 1] = durationSeconds;
	row[gh['eco_code'] - 1] = ecoCode;
	row[gh['eco_url'] - 1] = ecoUrl;
	row[gh['fen'] - 1] = String(game.fen || '');
	row[gh['tournament_url'] - 1] = String(game.tournament || '');
	row[gh['match_url'] - 1] = String(game.match || '');
	row[gh['pgn_moves'] - 1] = pgnInfo.moves || '';
	row[gh['callback.status'] - 1] = '';
	row[gh['callback.attempts'] - 1] = '';
	row[gh['callback.last_error'] - 1] = '';
	row[gh['callback.last_attempt_ts'] - 1] = '';
	row[gh['callback.ratingChangeWhite'] - 1] = '';
	row[gh['callback.ratingChangeBlack'] - 1] = '';
	row[gh['callback.ratingChangeMe'] - 1] = '';
	row[gh['callback.ratingChangeOpponent'] - 1] = '';
	row[gh['callback.gameEndReason'] - 1] = '';
	row[gh['callback.resultMessage'] - 1] = '';
	row[gh['callback.plyCount'] - 1] = '';
	row[gh['callback.isCheckmate'] - 1] = '';
	row[gh['callback.isStalemate'] - 1] = '';
	row[gh['callback.colorOfWinner'] - 1] = '';
	row[gh['my.is_computer'] - 1] = '';
	row[gh['my.membership_code'] - 1] = '';
	row[gh['my.membership_level'] - 1] = '';
	row[gh['my.member_since'] - 1] = '';
	row[gh['my.country_name'] - 1] = '';
	row[gh['my.location'] - 1] = '';
	row[gh['my.default_tab'] - 1] = '';
	row[gh['my.post_move_action'] - 1] = '';
	row[gh['my.turn_time_remaining'] - 1] = '';
	row[gh['my.has_moved_at_least_once'] - 1] = '';
	row[gh['opponent.is_computer'] - 1] = '';
	row[gh['opponent.membership_code'] - 1] = '';
	row[gh['opponent.membership_level'] - 1] = '';
	row[gh['opponent.member_since'] - 1] = '';
	row[gh['opponent.country_name'] - 1] = '';
	row[gh['opponent.location'] - 1] = '';
	row[gh['opponent.default_tab'] - 1] = '';
	row[gh['opponent.post_move_action'] - 1] = '';
	row[gh['opponent.turn_time_remaining'] - 1] = '';
	row[gh['opponent.has_moved_at_least_once'] - 1] = '';
	row[gh['created_ts'] - 1] = U.now();
	row[gh['updated_ts'] - 1] = U.now();
	return row;
}

function deriveCallbackUrl(gameUrl, gameType) {
	if (!gameUrl) return '';
	var m = gameUrl.match(/\/game\/(live|daily)\/(\d+)/);
	var id = m ? m[2] : (gameUrl.split('/').pop() || '');
	var kind = (m ? m[1] : (gameType || 'live'));
	return id ? ('https://www.chess.com/callback/' + kind + '/game/' + id) : '';
}

function parsePgnHeadersAndMoves(pgn) {
	var out = { startDate: '', endDate: '', ecoCode: '', ecoUrl: '', moves: '' };
	if (!pgn) return out;
	var lines = pgn.split(/\r?\n/);
	var headers = {};
	var i = 0;
	for (; i < lines.length; i++) {
		var line = lines[i];
		if (!line) continue;
		if (line[0] !== '[') break;
		var m = line.match(/^\[(\w+)\s+"([^"]*)"\]$/);
		if (m) headers[m[1]] = m[2];
	}
	function parseDateTime(d, t) {
		if (!d && !t) return '';
		var ds = (d || '').replace(/\./g, '-');
		var ts = (t || '00:00:00').replace(/\./g, ':');
		var iso = ds + 'T' + ts + 'Z';
		var dt = new Date(iso);
		return isNaN(dt.getTime()) ? '' : dt;
	}
	var start = parseDateTime(headers.UTCDate || headers.Date || '', headers.UTCTime || headers.Time || '');
	var end = parseDateTime(headers.EndDate || headers.Date || '', headers.EndTime || headers.Time || '');
	out.startDate = start || '';
	out.endDate = end || '';
	out.ecoCode = headers.ECO || '';
	out.ecoUrl = headers.ECOUrl || '';
	// Remaining lines presumed moves; join and trim
	var moves = lines.slice(i).join(' ').trim();
	out.moves = moves || '';
	return out;
}

function processCallbackQueue() {
	LOG.info('callbacks', 'processCallbackQueue', '', 'Stub - to implement');
}

function updatePlayerStats() {
	LOG.info('stats', 'updatePlayerStats', '', 'Stub - to implement');
}

function dailyRollupRebuild() {
	LOG.info('rollup', 'dailyRollupRebuild', '', 'Stub - to implement');
}

function rebuildMeta() {
	LOG.info('system', 'rebuildMeta', '', 'Stub - to implement');
}

function dailyRollupIncremental(dates) {
	LOG.info('rollup', 'dailyRollupIncremental', '', 'Stub - to implement', { dates: dates });
}