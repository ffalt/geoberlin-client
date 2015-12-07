/*
 * AJAX Utility function (implements basic HTTP get)
 */
var AJAX = {
	serialize: function (params) {
		var data = '';

		for (var key in params) {
			if (params.hasOwnProperty(key)) {
				var param = params[key];
				var type = param.toString();
				var value;

				if (data.length) {
					data += '&';
				}

				switch (type) {
					case '[object Array]':
						value = (param[0].toString() === '[object Object]') ? JSON.stringify(param) : param.join(',');
						break;
					case '[object Object]':
						value = JSON.stringify(param);
						break;
					case '[object Date]':
						value = param.valueOf();
						break;
					default:
						value = param;
						break;
				}

				data += encodeURIComponent(key) + '=' + encodeURIComponent(value);
			}
		}

		return data;
	},
	http_request: function (callback, context) {
		if (window.XDomainRequest) {
			return this.xdr(callback, context);
		} else {
			return this.xhr(callback, context);
		}
	},
	xhr: function (callback, context) {
		var xhr = new XMLHttpRequest();

		xhr.onerror = function (e) {
			xhr.onreadystatechange = L.Util.falseFn;
			var error = {
				code: xhr.status,
				message: xhr.statusText
			};

			callback.call(context, error, null);
		};

		xhr.onreadystatechange = function () {
			var response;
			var error;

			if (xhr.readyState === 4) {
				// Handle all non-200 responses first
				if (xhr.status !== 200) {
					error = {
						code: xhr.status,
						message: xhr.statusText
					};
					callback.call(context, error, null);
				} else {
					try {
						response = JSON.parse(xhr.responseText);
					} catch (e) {
						response = null;
						error = {
							code: 500,
							message: 'Parse Error'
						};
					}

					if (!error && response.error) {
						error = response.error;
						response = null;
					}

					xhr.onerror = L.Util.falseFn;

					callback.call(context, error, response);
				}
			}
		};

		return xhr;
	},
	xdr: function (callback, context) {
		var xdr = new window.XDomainRequest();

		xdr.onerror = function (e) {
			xdr.onload = L.Util.falseFn;

			// XDRs have no access to actual status codes
			var error = {
				code: 500,
				message: 'XMLHttpRequest Error'
			};
			callback.call(context, error, null);
		};

		// XDRs have .onload instead of .onreadystatechange
		xdr.onload = function () {
			var response;
			var error;

			try {
				response = JSON.parse(xdr.responseText);
			} catch (e) {
				response = null;
				error = {
					code: 500,
					message: 'Parse Error'
				};
			}

			if (!error && response.error) {
				error = response.error;
				response = null;
			}

			xdr.onerror = L.Util.falseFn;
			callback.call(context, error, response);
		};

		return xdr;
	},
	request: function (url, params, callback, context) {
		var paramString = this.serialize(params);
		var httpRequest = this.http_request(callback, context);

		httpRequest.open('GET', url + '?' + paramString);

		setTimeout(function () {
			httpRequest.send(null);
		}, 0);
	}
};

var BerlinGeoCoder = function (options) {
	var me = this;
	me.apiKey = options.apikey;
	//me.attribution = options.attribution || 'Geocoding by <a href=\'https://mapzen.com/pelias\'>Pelias</a>';
	me.url = options.url || 'https://geocode.dsst.io/berlin/v1';
	// For IE8 compatibility (if XDomainRequest is present),
	// we set the default value of options.url to the protocol-relative
	// version, because XDomainRequest does not allow http-to-https requests
	// This is set first so it can always be overridden by the user
	if (window.XDomainRequest && (!options.url)) {
		me.url = '//geocode.dsst.io/berlin/v1';
	}
	// Timestamp of the last response which was successfully rendered to the UI.
	// The time represents when the request was *sent*, not when it was recieved.
	var maxReqTimestampRendered = new Date().getTime();

	me.callCoder = function (endpoint, params, cb) {
		// Search API key
		if (me.apiKey) {
			params.api_key = me.apiKey;
		}
		// Track when the request began
		var reqStartedAt = new Date().getTime();
		AJAX.request(endpoint, params, function (err, results) {
			if (err) {
				console.error(err);
				switch (err.code) {
					case 429:
						return cb('There were too many requests. Try again in a second.');
					case 403:
						return cb('A valid API key is needed for this search feature.');
					case 500:
						return cb('The search service is not working right now. Please try again later.');
					// Note the status code is 0 if CORS is not enabled on the error response
					default:
						return cb('The search service is having problems :-(');
				}
			}

			if (results) {
				// Ignore requests that started before a request which has already
				// been successfully rendered on to the UI.
				if (maxReqTimestampRendered < reqStartedAt) {
					maxReqTimestampRendered = reqStartedAt;
					return cb(null, results);
				}
				// Else ignore the request, it is stale.
			}
			console.log('Ignoring request');
			cb();
		}, me);
	};

	var packageTextParameters = function (parameters) {
		var params = {text: parameters.query};
		//if (parameters.latlng) {
		//	params['focus.point.lat'] = parameters.latlng.lat;
		//	params['focus.point.lon'] = parameters.latlng.lng;
		//}
		//if (parameters.boundingbox) {
		//	params['boundary.rect.min_lon'] = parameters.boundingbox.min_lon;
		//	params['boundary.rect.min_lat'] = parameters.boundingbox.min_lat;
		//	params['boundary.rect.max_lon'] = parameters.boundingbox.max_lon;
		//	params['boundary.rect.max_lat'] = parameters.boundingbox.max_lat;
		//}
		if (parameters.layers) {
			params['layers'] = parameters.layers;
		}
		if (parameters.region) {
			params['region'] = parameters.region;
		}
		return params;
	};

	me.search = function (parameters, cb) {
		me.callCoder(me.url + '/search', packageTextParameters(parameters), cb);
	};

	me.autocomplete = function (parameters, cb) {
		me.callCoder(me.url + '/autocomplete', packageTextParameters(parameters), cb);
	};

	me.near = function (parameters, cb) {
		me.callCoder(me.url + '/near', {lat: parameters.query.lat, lon: parameters.query.lon, acc: parameters.query.accuracy}, cb);
	};

	me.get = function (parameters, cb) {
		me.callCoder(me.url + '/get', {id: parameters.id, housenr: parameters.housenr}, cb);
	};

	me.select = function (parameters, cb) {
		if (!parameters || !parameters.query || !parameters.query.properties) return cb('Invalid select parameter.');
		var feature = parameters.query;
		parameters.query = feature.properties.name;
		parameters.region = feature.properties.region;
		me.callCoder(me.url + '/autocomplete', packageTextParameters(parameters), cb);
	};

	me.canSelect = function (feature) {
		return feature && feature.properties && (feature.properties.layer == 'street');
	};


};
