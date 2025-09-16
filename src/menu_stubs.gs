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
		// Ensure archive_name reflects the actual archive name derived from URL
		var derivedArchiveName = deriveArchiveNameFromUrl(archiveUrl);
		if (derivedArchiveName && archiveName !== derivedArchiveName) {
			archiveName = derivedArchiveName;
			// Optionally update the Archives sheet row to keep it corrected
			arow[ah['archive_name'] - 1] = derivedArchiveName;
			archivesSheet.getRange(ai + 2, 1, 1, CONST.ARCHIVES_HEADERS.length).setValues([arow]);
		}
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

function deriveArchiveNameFromUrl(archiveUrl) {
	if (!archiveUrl) return '';
	var parts = String(archiveUrl).split('/');
	if (parts.length < 2) return '';
	var mm = parts.pop();
	var yyyy = parts.pop();
	if (!yyyy || !mm) return '';
	return yyyy + '-' + mm;
}

function processCallbackQueue() {
	var settings = U.readSettings();
	var maxCallbacks = Number(settings.max_callbacks_per_run || '200');
	var sheet = U.getOrCreateSheet(CONST.SHEET.GAMES);
	U.ensureHeaders(sheet, CONST.GAMES_HEADERS);
	var gh = U.getHeaderIndexMap(sheet);
	var lastRow = sheet.getLastRow();
	if (lastRow < 2) {
		LOG.info('callbacks', 'processCallbackQueue', '', 'No games to process');
		return;
	}
	var rows = sheet.getRange(2, 1, lastRow - 1, CONST.GAMES_HEADERS.length).getValues();
	var processed = 0;
	for (var i = 0; i < rows.length; i++) {
		if (processed >= maxCallbacks) break;
		var row = rows[i];
		var url = String(row[gh['callback_url'] - 1] || '');
		var status = String(row[gh['callback.status'] - 1] || '');
		var attempts = Number(row[gh['callback.attempts'] - 1] || 0);
		if (!url) continue;
		if (status && status.toLowerCase() === 'ok') continue;
		// Attempt fetch
		var resp = null;
		try {
			resp = HTTP.fetchWithEtag(url, '');
			attempts = attempts + 1;
			row[gh['callback.attempts'] - 1] = attempts;
			row[gh['callback.last_attempt_ts'] - 1] = U.now();
			if (resp && resp.status >= 200 && resp.status < 300) {
				row[gh['callback.status'] - 1] = 'ok';
				row[gh['callback.last_error'] - 1] = '';
				// Opportunistically map known fields if they exist
				var j = resp.json || {};
				if (gh['callback.ratingChangeWhite'] && j.ratingChangeWhite != null) row[gh['callback.ratingChangeWhite'] - 1] = Number(j.ratingChangeWhite);
				if (gh['callback.ratingChangeBlack'] && j.ratingChangeBlack != null) row[gh['callback.ratingChangeBlack'] - 1] = Number(j.ratingChangeBlack);
				if (gh['callback.ratingChangeMe'] && j.ratingChangeMe != null) row[gh['callback.ratingChangeMe'] - 1] = Number(j.ratingChangeMe);
				if (gh['callback.ratingChangeOpponent'] && j.ratingChangeOpponent != null) row[gh['callback.ratingChangeOpponent'] - 1] = Number(j.ratingChangeOpponent);
				if (gh['callback.gameEndReason'] && j.gameEndReason != null) row[gh['callback.gameEndReason'] - 1] = String(j.gameEndReason);
				if (gh['callback.resultMessage'] && j.resultMessage != null) row[gh['callback.resultMessage'] - 1] = String(j.resultMessage);
				if (gh['callback.plyCount'] && j.plyCount != null) row[gh['callback.plyCount'] - 1] = Number(j.plyCount);
				if (gh['callback.isCheckmate'] && j.isCheckmate != null) row[gh['callback.isCheckmate'] - 1] = !!j.isCheckmate;
				if (gh['callback.isStalemate'] && j.isStalemate != null) row[gh['callback.isStalemate'] - 1] = !!j.isStalemate;
				if (gh['callback.colorOfWinner'] && j.colorOfWinner != null) row[gh['callback.colorOfWinner'] - 1] = String(j.colorOfWinner);
			} else {
				row[gh['callback.status'] - 1] = 'error';
				row[gh['callback.last_error'] - 1] = 'HTTP ' + (resp ? resp.status : 'ERR');
			}
		} catch (e) {
			row[gh['callback.status'] - 1] = 'error';
			row[gh['callback.last_error'] - 1] = (e && e.message) ? String(e.message).slice(0, 500) : 'Unknown error';
			row[gh['callback.last_attempt_ts'] - 1] = U.now();
			rsp = null;
		}
		// Persist this row
		sheet.getRange(i + 2, 1, 1, CONST.GAMES_HEADERS.length).setValues([row]);
		processed++;
	}
	LOG.info('callbacks', 'processCallbackQueue:end', '', 'Processed', { processed: processed });
}

function updatePlayerStats() {
	var settings = U.readSettings();
	var username = String(settings.username || '').trim();
	if (!username) {
		LOG.error('stats', 'updatePlayerStats', '', 'Missing username in Settings');
		throw new Error('Please set username in Settings sheet.');
	}
	var url = 'https://api.chess.com/pub/player/' + encodeURIComponent(username) + '/stats';
	var resp = HTTP.fetchWithEtag(url, '');
	if (!(resp.status >= 200 && resp.status < 300) || !resp.json) {
		LOG.warn('stats', 'updatePlayerStats', url, 'HTTP ' + resp.status);
		return;
	}
	var j = resp.json || {};
	function get(root, pathArr) {
		var cur = root;
		for (var i = 0; i < pathArr.length; i++) {
			if (!cur) return null;
			cur = cur[pathArr[i]];
		}
		return cur;
	}
	function dt(val) {
		var n = Number(val || 0);
		return n ? U.toSheetDate(n) : '';
	}
	var sheet = U.getOrCreateSheet(CONST.SHEET.PLAYER_STATS);
	U.ensureHeaders(sheet, CONST.PLAYER_STATS_HEADERS);
	var row = new Array(CONST.PLAYER_STATS_HEADERS.length);
	var mapIdx = {};
	for (var c = 0; c < CONST.PLAYER_STATS_HEADERS.length; c++) mapIdx[CONST.PLAYER_STATS_HEADERS[c]] = c;
	row[mapIdx['snapshot_ts']] = U.now();
	row[mapIdx['username']] = username;
	var cats = ['chess_bullet', 'chess_blitz', 'chess_rapid', 'chess_daily'];
	for (var ci = 0; ci < cats.length; ci++) {
		var cat = cats[ci];
		row[mapIdx[cat + '.last_date']] = dt(get(j, [cat, 'last', 'date']));
		row[mapIdx[cat + '.last_rating']] = Number(get(j, [cat, 'last', 'rating']) || '');
		row[mapIdx[cat + '.last_rd']] = Number(get(j, [cat, 'last', 'rd']) || '');
		row[mapIdx[cat + '.best_date']] = dt(get(j, [cat, 'best', 'date']));
		row[mapIdx[cat + '.best_rating']] = Number(get(j, [cat, 'best', 'rating']) || '');
		row[mapIdx[cat + '.best_game_url']] = String(get(j, [cat, 'best', 'game']) || '');
		row[mapIdx[cat + '.record_win']] = Number(get(j, [cat, 'record', 'win']) || '');
		row[mapIdx[cat + '.record_loss']] = Number(get(j, [cat, 'record', 'loss']) || '');
		row[mapIdx[cat + '.record_draw']] = Number(get(j, [cat, 'record', 'draw']) || '');
		row[mapIdx[cat + '.record_time_per_move']] = Number(get(j, [cat, 'record', 'time_per_move']) || '');
		row[mapIdx[cat + '.record_timeout_percent']] = Number(get(j, [cat, 'record', 'timeout_percent']) || '');
		row[mapIdx[cat + '.tournament_count']] = Number(get(j, [cat, 'tournament', 'count']) || '');
		row[mapIdx[cat + '.tournament_withdraw']] = Number(get(j, [cat, 'tournament', 'withdraw']) || '');
		row[mapIdx[cat + '.tournament_points']] = Number(get(j, [cat, 'tournament', 'points']) || '');
		row[mapIdx[cat + '.tournament_highest_finish']] = String(get(j, [cat, 'tournament', 'highest_finish']) || '');
	}
	// chess960_daily may appear as chess960 or chess960_daily depending on API evolution
	var c960 = j.chess960_daily || j.chess960 || null;
	if (c960) {
		row[mapIdx['chess960_daily.last_date']] = dt(get(c960, ['last', 'date']));
		row[mapIdx['chess960_daily.last_rating']] = Number(get(c960, ['last', 'rating']) || '');
		row[mapIdx['chess960_daily.last_rd']] = Number(get(c960, ['last', 'rd']) || '');
		row[mapIdx['chess960_daily.best_date']] = dt(get(c960, ['best', 'date']));
		row[mapIdx['chess960_daily.best_rating']] = Number(get(c960, ['best', 'rating']) || '');
		row[mapIdx['chess960_daily.best_game_url']] = String(get(c960, ['best', 'game']) || '');
		row[mapIdx['chess960_daily.record_win']] = Number(get(c960, ['record', 'win']) || '');
		row[mapIdx['chess960_daily.record_loss']] = Number(get(c960, ['record', 'loss']) || '');
		row[mapIdx['chess960_daily.record_draw']] = Number(get(c960, ['record', 'draw']) || '');
		row[mapIdx['chess960_daily.record_time_per_move']] = Number(get(c960, ['record', 'time_per_move']) || '');
		row[mapIdx['chess960_daily.record_timeout_percent']] = Number(get(c960, ['record', 'timeout_percent']) || '');
	}
	// Tactics
	if (j.tactics) {
		row[mapIdx['tactics.highest_rating']] = Number(get(j, ['tactics', 'highest', 'rating']) || '');
		row[mapIdx['tactics.highest_date']] = dt(get(j, ['tactics', 'highest', 'date']));
		row[mapIdx['tactics.lowest_rating']] = Number(get(j, ['tactics', 'lowest', 'rating']) || '');
		row[mapIdx['tactics.lowest_date']] = dt(get(j, ['tactics', 'lowest', 'date']));
	}
	// Lessons
	if (j.lessons) {
		row[mapIdx['lessons.highest_rating']] = Number(get(j, ['lessons', 'highest', 'rating']) || '');
		row[mapIdx['lessons.highest_date']] = dt(get(j, ['lessons', 'highest', 'date']));
		row[mapIdx['lessons.lowest_rating']] = Number(get(j, ['lessons', 'lowest', 'rating']) || '');
		row[mapIdx['lessons.lowest_date']] = dt(get(j, ['lessons', 'lowest', 'date']));
	}
	// Puzzle Rush
	if (j.puzzle_rush) {
		row[mapIdx['puzzle_rush.daily_total_attempts']] = Number(get(j, ['puzzle_rush', 'daily', 'total_attempts']) || '');
		row[mapIdx['puzzle_rush.daily_score']] = Number(get(j, ['puzzle_rush', 'daily', 'score']) || '');
		row[mapIdx['puzzle_rush.best_total_attempts']] = Number(get(j, ['puzzle_rush', 'best', 'total_attempts']) || '');
		row[mapIdx['puzzle_rush.best_score']] = Number(get(j, ['puzzle_rush', 'best', 'score']) || '');
	}
	sheet.appendRow(row);
	LOG.info('stats', 'updatePlayerStats:end', '', 'Appended player stats');
}

function dailyRollupRebuild() {
	var gamesSheet = U.getOrCreateSheet(CONST.SHEET.GAMES);
	U.ensureHeaders(gamesSheet, CONST.GAMES_HEADERS);
	var gh = U.getHeaderIndexMap(gamesSheet);
	var last = gamesSheet.getLastRow();
	var rollSheet = U.getOrCreateSheet(CONST.SHEET.DAILY_ROLLUP);
	U.ensureHeaders(rollSheet, CONST.DAILY_ROLLUP_PREFIX_HEADERS);
	var agg = {};
	if (last >= 2) {
		var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
		var vals = gamesSheet.getRange(2, 1, last - 1, CONST.GAMES_HEADERS.length).getValues();
		for (var i = 0; i < vals.length; i++) {
			var r = vals[i];
			var endDt = r[gh['end_dt'] - 1];
			if (!(endDt && endDt instanceof Date)) continue;
			var day = Utilities.formatDate(endDt, tz, 'yyyy-MM-dd');
			if (!agg[day]) agg[day] = { wins: 0, losses: 0, draws: 0, duration: 0 };
			var res = String(r[gh['my.result'] - 1] || '').toLowerCase();
			if (res === 'win') agg[day].wins++;
			else if (res === 'loss') agg[day].losses++;
			else if (res === 'draw' || res === 'stalemate' || res === 'agreed') agg[day].draws++;
			agg[day].duration += Number(r[gh['duration'] - 1] || 0);
		}
	}
	// Write out sorted by date ascending
	var keys = Object.keys(agg).sort();
	// Clear existing (except header)
	if (rollSheet.getLastRow() > 1) rollSheet.getRange(2, 1, rollSheet.getLastRow() - 1, rollSheet.getLastColumn()).clearContent();
	if (keys.length) {
		var out = new Array(keys.length);
		for (var k = 0; k < keys.length; k++) {
			var d = keys[k];
			var a = agg[d];
			out[k] = [new Date(d + 'T00:00:00Z'), a.wins, a.losses, a.draws, a.duration];
		}
		rollSheet.getRange(2, 1, out.length, CONST.DAILY_ROLLUP_PREFIX_HEADERS.length).setValues(out);
	}
	LOG.info('rollup', 'dailyRollupRebuild:end', '', 'Rebuilt', { days: keys.length });
}

function rebuildMeta() {
	// Ensure all sheets and headers exist
	buildSheets();
	// Re-establish archive activity flags
	var archivesSheet = U.getOrCreateSheet(CONST.SHEET.ARCHIVES);
	U.ensureHeaders(archivesSheet, CONST.ARCHIVES_HEADERS);
	var ah = U.getHeaderIndexMap(archivesSheet);
	establishArchiveActivity(archivesSheet, ah);
	// Backfill/fix archive_name in Games to match Archives
	var idToName = {};
	var lastA = archivesSheet.getLastRow();
	if (lastA >= 2) {
		var aVals = archivesSheet.getRange(2, 1, lastA - 1, CONST.ARCHIVES_HEADERS.length).getValues();
		for (var i = 0; i < aVals.length; i++) {
			var id = aVals[i][ah['id'] - 1];
			var nm = String(aVals[i][ah['archive_name'] - 1] || '');
			var url = String(aVals[i][ah['archive_url'] - 1] || '');
			if (!nm) nm = deriveArchiveNameFromUrl(url);
			if (id) idToName[id] = nm;
		}
	}
	var gamesSheet = U.getOrCreateSheet(CONST.SHEET.GAMES);
	U.ensureHeaders(gamesSheet, CONST.GAMES_HEADERS);
	var gh = U.getHeaderIndexMap(gamesSheet);
	var lastG = gamesSheet.getLastRow();
	if (lastG >= 2) {
		var gIds = gamesSheet.getRange(2, gh['archive_id'], lastG - 1, 1).getValues();
		var gUrls = gamesSheet.getRange(2, gh['archive_url'], lastG - 1, 1).getValues();
		var namesCol = gamesSheet.getRange(2, gh['archive_name'], lastG - 1, 1).getValues();
		var changed = false;
		for (var r = 0; r < gIds.length; r++) {
			var idVal = gIds[r][0];
			var cur = String(namesCol[r][0] || '');
			var desired = '';
			if (idVal && idToName[idVal] != null) desired = String(idToName[idVal] || '');
			if (!desired) desired = deriveArchiveNameFromUrl(String(gUrls[r][0] || ''));
			if (desired && cur !== desired) {
				namesCol[r][0] = desired;
				changed = true;
			}
		}
		if (changed) gamesSheet.getRange(2, gh['archive_name'], lastG - 1, 1).setValues(namesCol);
	}
	LOG.info('system', 'rebuildMeta:end', '', 'Rebuilt meta and fixed archive_name in Games');
}

function dailyRollupIncremental(dates) {
	dates = Array.isArray(dates) ? dates.slice() : [];
	if (!dates.length) return;
	var set = {};
	for (var i = 0; i < dates.length; i++) set[String(dates[i])] = true;
	var gamesSheet = U.getOrCreateSheet(CONST.SHEET.GAMES);
	U.ensureHeaders(gamesSheet, CONST.GAMES_HEADERS);
	var gh = U.getHeaderIndexMap(gamesSheet);
	var last = gamesSheet.getLastRow();
	if (last < 2) return;
	var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
	var vals = gamesSheet.getRange(2, 1, last - 1, CONST.GAMES_HEADERS.length).getValues();
	var agg = {};
	for (var r = 0; r < vals.length; r++) {
		var row = vals[r];
		var endDt = row[gh['end_dt'] - 1];
		if (!(endDt && endDt instanceof Date)) continue;
		var day = Utilities.formatDate(endDt, tz, 'yyyy-MM-dd');
		if (!set[day]) continue;
		if (!agg[day]) agg[day] = { wins: 0, losses: 0, draws: 0, duration: 0 };
		var res = String(row[gh['my.result'] - 1] || '').toLowerCase();
		if (res === 'win') agg[day].wins++;
		else if (res === 'loss') agg[day].losses++;
		else if (res === 'draw' || res === 'stalemate' || res === 'agreed') agg[day].draws++;
		agg[day].duration += Number(row[gh['duration'] - 1] || 0);
	}
	var rollSheet = U.getOrCreateSheet(CONST.SHEET.DAILY_ROLLUP);
	U.ensureHeaders(rollSheet, CONST.DAILY_ROLLUP_PREFIX_HEADERS);
	// Build a map of date->rowIndex (in sheet coordinates)
	var dh = (function(){ var m = {}; for (var i = 0; i < CONST.DAILY_ROLLUP_PREFIX_HEADERS.length; i++) m[CONST.DAILY_ROLLUP_PREFIX_HEADERS[i]] = i + 1; return m; })();
	var lastR = rollSheet.getLastRow();
	var existing = {};
	if (lastR >= 2) {
		var dr = rollSheet.getRange(2, 1, lastR - 1, CONST.DAILY_ROLLUP_PREFIX_HEADERS.length).getValues();
		for (var i2 = 0; i2 < dr.length; i2++) {
			var dval = dr[i2][0];
			if (dval && dval instanceof Date) {
				var key = Utilities.formatDate(dval, tz, 'yyyy-MM-dd');
				existing[key] = i2 + 2; // sheet row index
			}
		}
	}
	var keys = Object.keys(agg);
	for (var k = 0; k < keys.length; k++) {
		var day = keys[k];
		var a = agg[day];
		var rowVals = [new Date(day + 'T00:00:00Z'), a.wins, a.losses, a.draws, a.duration];
		if (existing[day]) {
			rollSheet.getRange(existing[day], 1, 1, CONST.DAILY_ROLLUP_PREFIX_HEADERS.length).setValues([rowVals]);
		} else {
			rollSheet.appendRow(rowVals);
		}
	}
	LOG.info('rollup', 'dailyRollupIncremental:end', '', 'Updated days', { days: keys.length });
}