// Sheet creation and menu

function onOpen() {
	var ui = SpreadsheetApp.getUi();
	ui.createMenu('Chess.com')
		.addItem('Build Sheets', 'buildSheets')
		.addItem('Seed Settings Defaults', 'seedSettingsDefaults')
		.addItem('Update Archives', 'updateArchives')
		.addItem('Fetch & Write Games', 'fetchAndWriteGames')
		.addItem('Process Callback Queue', 'processCallbackQueue')
		.addItem('Update Player Stats', 'updatePlayerStats')
		.addItem('Daily Rollup (Full Rebuild)', 'dailyRollupRebuild')
		.addItem('Rebuild Meta', 'rebuildMeta')
		.addToUi();
}

function buildSheets() {
	LOG.info('system', 'buildSheets', '', 'Starting');
	var s;
	// Settings
	s = U.getOrCreateSheet(CONST.SHEET.SETTINGS);
	U.ensureHeaders(s, ['key', 'value']);
	// Archives
	s = U.getOrCreateSheet(CONST.SHEET.ARCHIVES);
	U.ensureHeaders(s, CONST.ARCHIVES_HEADERS);
	// Games
	s = U.getOrCreateSheet(CONST.SHEET.GAMES);
	U.ensureHeaders(s, CONST.GAMES_HEADERS);
	// Player Stats
	s = U.getOrCreateSheet(CONST.SHEET.PLAYER_STATS);
	U.ensureHeaders(s, CONST.PLAYER_STATS_HEADERS);
	// Daily Rollup (prefix only, formats will be added later)
	s = U.getOrCreateSheet(CONST.SHEET.DAILY_ROLLUP);
	U.ensureHeaders(s, CONST.DAILY_ROLLUP_PREFIX_HEADERS);
	// Logs
	s = U.getOrCreateSheet(CONST.SHEET.LOGS);
	U.ensureHeaders(s, ['ts', 'level', 'scope', 'action', 'key', 'message', 'data_json']);
	LOG.info('system', 'buildSheets', '', 'Completed');
}

function seedSettingsDefaults() {
	LOG.info('system', 'seedSettingsDefaults', '', 'Starting');
	U.setKeyValueSettings(CONST.SETTINGS_DEFAULTS);
	LOG.info('system', 'seedSettingsDefaults', '', 'Completed');
}