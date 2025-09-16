// Logger utility writing to Logs sheet

var LOG = (function() {
	function write(level, scope, action, key, message, data) {
		try {
			var sh = U.getOrCreateSheet(CONST.SHEET.LOGS);
			U.ensureHeaders(sh, ['ts', 'level', 'scope', 'action', 'key', 'message', 'data_json']);
			var row = [U.now(), level, scope, action, key || '', message || '', data ? JSON.stringify(data).slice(0, 50000) : ''];
			sh.appendRow(row);
		} catch (e) {
			// Swallow logging errors to avoid cascading failures
		}
	}
	return {
		info: function(scope, action, key, message, data){ write('INFO', scope, action, key, message, data); },
		warn: function(scope, action, key, message, data){ write('WARN', scope, action, key, message, data); },
		error: function(scope, action, key, message, data){ write('ERROR', scope, action, key, message, data); },
		debug: function(scope, action, key, message, data){ write('DEBUG', scope, action, key, message, data); }
	};
})();