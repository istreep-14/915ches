// Combined Update Archives workflow: fetch + append new + establish activity + optional change checks

function updateArchives() {
	var settings = U.readSettings();
	LOG.info('archives', 'updateArchives:start', '', 'Settings', settings);
	var username = (settings.username || '').trim();
	if (!username) {
		LOG.error('archives', 'updateArchives', '', 'Missing username in Settings');
		throw new Error('Please set username in Settings sheet.');
	}
	var maxArchives = Number(settings.max_archives_per_run || '50');
	var checkChanges = String(settings.archives_check_before_fetch || 'false').toLowerCase() === 'true';

	var archivesSheet = U.getOrCreateSheet(CONST.SHEET.ARCHIVES);
	U.ensureHeaders(archivesSheet, CONST.ARCHIVES_HEADERS);
	var hmap = U.getHeaderIndexMap(archivesSheet);

	// 1) Fetch overall archives list with ETag (persist by username)
	var listUrl = 'https://api.chess.com/pub/player/' + encodeURIComponent(username) + '/games/archives';
	var listEtagKey = 'archives_list_etag__' + username.toLowerCase();
	var prevEtag = U.getScriptProp(listEtagKey) || '';
	var resp = HTTP.fetchWithEtag(listUrl, prevEtag);
	if (resp.status === 304) {
		LOG.info('archives', 'archivesList', listUrl, 'Not Modified');
	} else if (resp.status >= 200 && resp.status < 300) {
		var arr = (resp.json && resp.json.archives) || [];
		if (!Array.isArray(arr)) arr = [];
		appendNewArchivesRows(archivesSheet, hmap, arr);
		LOG.info('archives', 'archivesList', listUrl, 'Fetched archives list', { count: arr.length });
		if (resp.etag) U.setScriptProp(listEtagKey, resp.etag);
	} else {
		LOG.warn('archives', 'archivesList', listUrl, 'Unexpected status ' + resp.status);
	}

	// 2) Establish activity flags
	establishArchiveActivity(archivesSheet, hmap);

	// 3) Optional: per-archive change checks (scoped via Settings)
	if (checkChanges) {
		checkChangedArchives(archivesSheet, hmap, username, maxArchives, settings);
	}

	LOG.info('archives', 'updateArchives:end', '', 'Done');
}

function appendNewArchivesRows(sheet, hmap, archiveUrls) {
	if (!archiveUrls.length) return;
	var lastRow = sheet.getLastRow();
	var existing = {};
	if (lastRow >= 2) {
		var urls = sheet.getRange(2, hmap['archive_url'], lastRow - 1, 1).getValues().map(function(r){ return String(r[0]||''); });
		for (var i = 0; i < urls.length; i++) if (urls[i]) existing[urls[i]] = true;
	}
	var currentMaxId = 0;
	if (lastRow >= 2) {
		var ids = sheet.getRange(2, hmap['id'], lastRow - 1, 1).getValues().map(function(r){ return Number(r[0]||0); });
		for (var j = 0; j < ids.length; j++) if (ids[j] > currentMaxId) currentMaxId = ids[j];
	}
	var toWrite = [];
	for (var k = 0; k < archiveUrls.length; k++) {
		var url = String(archiveUrls[k]);
		if (existing[url]) continue;
		var parts = url.split('/');
		var mm = parts.pop();
		var yyyy = parts.pop();
		var name = yyyy + '-' + mm;
		toWrite.push([
			currentMaxId + toWrite.length + 1, // id
			url,                              // archive_url
			name,                             // archive_name
			Number(yyyy),                     // year
			Number(mm),                       // month
			'',                               // etag
			'',                               // last_modified
			'',                               // last_checked_changes_ts
			'',                               // last_checked_new_ts
			'',                               // last_seen_url
			'',                               // game_count
			true,                             // is_active (initially true until evaluated)
			U.now(),                          // created_ts
			U.now(),                          // updated_ts
			''                                // notes
		]);
	}
	if (toWrite.length) sheet.getRange(sheet.getLastRow() + 1, 1, toWrite.length, CONST.ARCHIVES_HEADERS.length).setValues(toWrite);
}

function endOfMonth(year, month) {
	// month: 1-12
	var d = new Date(year, month, 0, 23, 59, 59, 999);
	return d;
}

function establishArchiveActivity(sheet, hmap) {
	var lastRow = sheet.getLastRow();
	if (lastRow < 2) return;
	var values = sheet.getRange(2, 1, lastRow - 1, CONST.ARCHIVES_HEADERS.length).getValues();
	var updates = [];
	for (var i = 0; i < values.length; i++) {
		var row = values[i];
		var year = Number(row[hmap['year'] - 1] || 0);
		var month = Number(row[hmap['month'] - 1] || 0);
		var lastChecked = row[hmap['last_checked_changes_ts'] - 1];
		var isActive = true;
		if (lastChecked instanceof Date) {
			var eom = endOfMonth(year, month);
			if (lastChecked.getTime() > eom.getTime()) isActive = false;
		}
		row[hmap['is_active'] - 1] = isActive;
		row[hmap['updated_ts'] - 1] = U.now();
		updates.push(row);
	}
	sheet.getRange(2, 1, updates.length, CONST.ARCHIVES_HEADERS.length).setValues(updates);
}

function checkChangedArchives(sheet, hmap, username, maxArchives, settings) {
	var lastRow = sheet.getLastRow();
	if (lastRow < 2) return;
	var allRows = sheet.getRange(2, 1, lastRow - 1, CONST.ARCHIVES_HEADERS.length).getValues();
	var indices = scopeArchiveRowIndices(allRows, hmap, settings);
	var checked = 0;
	for (var idx = 0; idx < indices.length; idx++) {
		if (checked >= maxArchives) break;
		var i = indices[idx];
		var row = allRows[i];
		var url = String(row[hmap['archive_url'] - 1] || '');
		if (!url) continue;
		var etag = String(row[hmap['etag'] - 1] || '');
		var resp = HTTP.fetchWithEtag(url, etag);
		if (resp.status >= 200 && resp.status < 300) {
			var games = (resp.json && (resp.json.games || resp.json['games'])) || [];
			var newCount = Array.isArray(games) ? games.length : 0;
			var oldCount = Number(row[hmap['game_count'] - 1] || 0);
			var newLastUrl = '';
			if (Array.isArray(games) && games.length) {
				var best = games[0];
				for (var g = 1; g < games.length; g++) {
					var a = Number((best && best.end_time) || 0);
					var b = Number((games[g] && games[g].end_time) || 0);
					if (b >= a) best = games[g];
				}
				newLastUrl = String((best && best.url) || games[games.length - 1].url || '');
			}
			var lastSeen = String(row[hmap['last_seen_url'] - 1] || '');
			var etagChanged = !!(resp.etag && resp.etag !== etag);
			var countChanged = newCount !== oldCount;
			var lastUrlChanged = newLastUrl && lastSeen && newLastUrl !== lastSeen;
			row[hmap['etag'] - 1] = resp.etag || row[hmap['etag'] - 1];
			row[hmap['last_modified'] - 1] = resp.lastModified || row[hmap['last_modified'] - 1];
			row[hmap['game_count'] - 1] = newCount;
			if (etagChanged || countChanged || lastUrlChanged) {
				LOG.info('archives', 'changed', url, 'Archive changed', { etagChanged: etagChanged, countChanged: countChanged, lastUrlChanged: lastUrlChanged, newCount: newCount });
			} else {
				LOG.debug('archives', 'unchanged', url, 'Archive unchanged');
			}
		} else if (resp.status === 304) {
			// unchanged
		} else {
			LOG.warn('archives', 'checkChanged', url, 'HTTP ' + resp.status);
		}
		row[hmap['last_checked_changes_ts'] - 1] = U.now();
		row[hmap['updated_ts'] - 1] = U.now();
		sheet.getRange(i + 2, 1, 1, CONST.ARCHIVES_HEADERS.length).setValues([row]);
		checked++;
	}
}

function scopeArchiveRowIndices(values, hmap, settings) {
	var mode = String(settings.scope_archives || 'all');
	var out = [];
	var idStart = Number(settings.scope_archives_id_start || '');
	var idEnd = Number(settings.scope_archives_id_end || '');
	var dateStart = String(settings.scope_archives_date_start || '').trim();
	var dateEnd = String(settings.scope_archives_date_end || '').trim();
	var startYM = parseYYYYMM(dateStart);
	var endYM = parseYYYYMM(dateEnd);
	for (var i = 0; i < values.length; i++) {
		var row = values[i];
		if (mode === 'active_only') {
			var active = !!row[hmap['is_active'] - 1];
			if (!active) continue;
		} else if (mode === 'id_range') {
			var idVal = Number(row[hmap['id'] - 1] || 0);
			if (idStart && idVal < idStart) continue;
			if (idEnd && idVal > idEnd) continue;
		} else if (mode === 'date_range') {
			var year = Number(row[hmap['year'] - 1] || 0);
			var month = Number(row[hmap['month'] - 1] || 0);
			var ym = year * 100 + month;
			if (startYM && ym < startYM) continue;
			if (endYM && ym > endYM) continue;
		}
		out.push(i);
	}
	return out;
}

function parseYYYYMM(s) {
	if (!s) return 0;
	var parts = String(s).split('-');
	if (parts.length !== 2) return 0;
	var y = Number(parts[0]);
	var m = Number(parts[1]);
	if (!y || !m) return 0;
	return y * 100 + m;
}