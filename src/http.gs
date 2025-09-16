// HTTP helper with ETag, retries, and backoff

var HTTP = (function() {
	function sleep(ms) { Utilities.sleep(ms); }

	function fetchWithEtag(url, etag, opts) {
		opts = opts || {};
		var settings = U.readSettings();
		var timeout = Number(settings.urlfetch_timeout_ms || '20000');
		var maxRetries = Number(settings.max_retries || '3');
		var initial = Number(settings.initial_backoff_ms || '500');
		var maxBack = Number(settings.max_backoff_ms || '5000');
		var headers = opts.headers || {};
		if (etag) headers['If-None-Match'] = etag;
		var payload = null;
		for (var attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				var response = UrlFetchApp.fetch(url, {
					muteHttpExceptions: true,
					headers: headers,
					method: 'get',
					followRedirects: true,
					contentType: 'application/json',
					timeout: timeout
				});
				var code = response.getResponseCode();
				var respHeaders = response.getAllHeaders();
				if (code === 304) {
					return { status: 304, etag: (respHeaders.ETag || respHeaders.Etag || respHeaders.etag || ''), lastModified: (respHeaders['Last-Modified'] || ''), text: '', json: null };
				}
				if (code >= 200 && code < 300) {
					var text = response.getContentText();
					var json = null;
					try { json = text ? JSON.parse(text) : null; } catch (e) {}
					return { status: code, etag: (respHeaders.ETag || respHeaders.Etag || respHeaders.etag || ''), lastModified: (respHeaders['Last-Modified'] || ''), text: text, json: json };
				}
				if (code === 429 || code >= 500) {
					throw new Error('Transient HTTP ' + code);
				}
				// Non-retryable
				return { status: code, etag: (respHeaders.ETag || ''), lastModified: (respHeaders['Last-Modified'] || ''), text: response.getContentText(), json: null };
			} catch (err) {
				if (attempt === maxRetries) throw err;
				var backoff = Math.min(maxBack, initial * Math.pow(2, attempt));
				sleep(backoff);
			}
		}
	}

	return { fetchWithEtag: fetchWithEtag };
})();