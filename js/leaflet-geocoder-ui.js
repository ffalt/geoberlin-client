// based on https://github.com/pelias/leaflet-geocoder

/*
 * This adds a geocoder powered by pelias to a leaflet map
 * TODO: Better comments
 */
;(function (factory) { // eslint-disable-line no-extra-semi
	var L;
	if (typeof define === 'function' && define.amd) {
		// AMD
		define(['leaflet'], factory);
	} else if (typeof module !== 'undefined') {
		// Node/CommonJS
		L = require('leaflet');
		module.exports = factory(L);
	} else {
		// Browser globals
		if (typeof window.L === 'undefined') {
			throw new Error('Leaflet must be loaded first');
		}
		factory(window.L);
	}
}(function (L) {
	'use strict';

	var FULL_WIDTH_MARGIN = 20; // in pixels
	var FULL_WIDTH_TOUCH_ADJUSTED_MARGIN = 4; // in pixels
	var RESULTS_HEIGHT_MARGIN = 20; // in pixels
	var API_RATE_LIMIT = 250; // in ms, throttled time between subsequent requests to API


	var EmptyGeoCoder = function () {
		var me = this;
		me.search = function (parameters, cb) {
			cb('No valid geocoder given.');
		};

		me.autocomplete = function (parameters, cb) {
			cb('No valid geocoder given.');
		};

		me.near = function (parameters, cb) {
			cb('No valid geocoder given.');
		};

		me.select = function (feature, cb) {
			cb('No valid geocoder given.');
		};
		me.canSelect = function (feature) {
			return false;
		};
	};

	L.Control.Geocoder = L.Control.extend({
		options: {
			position: 'topleft',
			placeholder: 'Search',
			title: 'Search',
			bounds: false,
			latlng: null,
			layers: null,
			panToPoint: true,
			pointIcon: 'images/point_icon.png',
			polygonIcon: 'images/polygon_icon.png',
			fullWidth: 650,
			minimumAutoCompleteInput: 1,
			markers: true,
			expanded: false,
			autocomplete: true
		},

		initialize: function (options) {
			//merge user-specified options
			L.Util.setOptions(this, options);
			this.geocoder = options.geocoder || new EmptyGeoCoder();
			this.options.attribution = this.options.attribution || this.geocoder.attribution;
			this.marker;
			this.markers = [];
		},

		getParamLayers: function () {
			var layers = this.options.layers;
			if (!layers) {
				return null;
			}
			return layers;
		},

		getParamBoundingBox: function () {
			/*
			 * this.options.bounds can be one of the following
			 * true //Boolean - take the map bounds
			 * false //Boolean - no bounds
			 * L.latLngBounds(...) //Object
			 * [[10, 10], [40, 60]] //Array
			 */
			var bounds = this.options.bounds;
			// If falsy, bail
			if (!bounds) {
				return null;
			}
			// If set to true, use map bounds
			// If it is a valid L.LatLngBounds object, get its values
			// If it is an array, try running it through L.LatLngBounds
			if (bounds === true) {
				bounds = this._map.getBounds();
				return makeParamsFromLeaflet(bounds);
			} else if (typeof bounds === 'object' && bounds.isValid && bounds.isValid()) {
				return makeParamsFromLeaflet(bounds);
			} else if (typeof bounds === 'object' && bounds.length > 0) {
				var latLngBounds = L.latLngBounds(bounds);
				if (latLngBounds.isValid && latLngBounds.isValid()) {
					return makeParamsFromLeaflet(latLngBounds);
				}
			}

			function makeParamsFromLeaflet(latLngBounds) {
				return {
					min_lon: latLngBounds.getWest(),
					min_lat: latLngBounds.getSouth(),
					max_lon: latLngBounds.getEast(),
					max_lat: latLngBounds.getNorth()
				};
			}

			return null;
		},

		getParamLatlng: function () {
			/*
			 * this.options.latlng can be one of the following
			 * [50, 30] //Array
			 * {lon: 30, lat: 50} //Object
			 * {lat: 50, lng: 30} //Object
			 * L.latLng(50, 30) //Object
			 * true //Boolean - take the map center
			 * false //Boolean - No latlng to be considered
			 */
			var latlng = this.options.latlng;

			if (!latlng) {
				return null;
			}

			if (latlng.constructor === Array) {
				// TODO Check for array size, throw errors if invalid lat/lon
				return {lat: latlng[0], lng: latlng[1]};
			} else if (typeof latlng !== 'object') {
				// fallback to the map's center L.latLng()
				return this._map.getCenter();
			} else {
				// TODO Check for valid L.LatLng Object or Object thats in the form of {lat:..,lon:..}
				// TODO Check for valid lat/lon values, Error handling
				return {lat: latlng.lat, lng: latlng.lng ? latlng.lng : latlng.lon};
			}
		},

		_execute: function (request, input) {
			if (!input) return;
			var params = {
				query: input,
				latlng: this.getParamLatlng(),
				boundingbox: this.getParamBoundingBox(),
				layers: this.getParamLayers()
			};
			var caller = this;
			request(params, function (errmsg, results) {
				L.DomUtil.removeClass(caller._search, 'leaflet-geocoderui-loading');
				if (errmsg) {
					return caller.showMessage(errmsg);
				}
				if (results && results.features) {
					caller.showResults(results.features)
				}
			});
			L.DomUtil.addClass(this._search, 'leaflet-geocoderui-loading');
		},

		search: function (input) {
			this._execute(this.geocoder.search, input);
		},

		autocomplete: throttle(function (input) {
			this._execute(this.geocoder.autocomplete, input);
		}, API_RATE_LIMIT),

		selectEntry: function (selected) {
			function setCaretPosition(elem, caretPos) {
				if (elem != null) {
					if (elem.createTextRange) {
						var range = elem.createTextRange();
						range.move('character', caretPos);
						range.select();
					}
					else {
						if (elem.selectionStart) {
							elem.focus();
							elem.setSelectionRange(caretPos, caretPos);
						}
						else
							elem.focus();
					}
				}
			}

			if (selected) {
				this.setSelectedResult();
				this.showMarker(selected.feature);
				this.clear();
				if (this.geocoder.select && this.geocoder.canSelect && this.geocoder.canSelect(selected.feature)) {
					setCaretPosition(this._input, selected.feature.properties.label.split(',')[0].length);
					this._execute(this.geocoder.select, selected.feature);
				}
			}
		},

		highlight: function (text, focus) {
			var r = new RegExp('(' + escapeRegExp(focus) + ')', 'gi');
			return text.replace(r, '<strong>$1</strong>');
		},

		getIconType: function (layer) {
			var pointIcon = this.options.pointIcon;
			var polygonIcon = this.options.polygonIcon;

			if (layer.match('venue') || layer.match('address')) {
				return pointIcon;
			} else {
				return polygonIcon;
			}
		},

		showResults: function (features) {

			if (this.options.onResults) {
				if (this.options.onResults(features)) return;
			}
			// Exit function if there are no features
			if (features.length === 0) {
				this.showMessage('No results were found.');
				return;
			}

			var list;
			var resultsContainer = this._results;

			// Reset and display results container
			resultsContainer.innerHTML = '';
			resultsContainer.style.display = 'block';
			// manage result box height
			resultsContainer.style.maxHeight = (this._map.getSize().y - resultsContainer.offsetTop - this._container.offsetTop - RESULTS_HEIGHT_MARGIN) + 'px';

			if (!list) {
				list = L.DomUtil.create('ul', 'leaflet-geocoderui-list', resultsContainer);
			}

			for (var i = 0, j = features.length; i < j; i++) {
				var feature = features[i];
				var resultItem = L.DomUtil.create('li', 'leaflet-geocoderui-result', list);

				resultItem.layer = feature.properties.layer;
				resultItem.coords = feature.geometry.coordinates;
				resultItem.feature = feature;

				var iconSrc = this.getIconType(feature.properties.layer);
				if (iconSrc) {
					// Point or polygon icon
					var layerIconContainer = L.DomUtil.create('span', 'leaflet-geocoderui-layer-icon-container', resultItem);
					var layerIcon = L.DomUtil.create('img', 'leaflet-geocoderui-layer-icon', layerIconContainer);
					layerIcon.src = iconSrc;
					layerIcon.title = 'layer: ' + feature.properties.layer;
				}

				if (this._input.value.length > 0) {
					resultItem.innerHTML += this.highlight(feature.properties.label, this._input.value);
				} else {
					resultItem.innerHTML += feature.properties.label;
				}

				if (feature.properties.distance > 0) {
					var distanceItem = L.DomUtil.create('span', 'leaflet-geocoderui-result-distance', resultItem);
					distanceItem.innerHTML = '~' + parseInt(feature.properties.distance) + 'm';
				}
			}
		},

		showMessage: function (text) {
			var resultsContainer = this._results;

			// Reset and display results container
			resultsContainer.innerHTML = '';
			resultsContainer.style.display = 'block';

			var messageEl = L.DomUtil.create('div', 'leaflet-geocoderui-message', resultsContainer);
			messageEl.textContent = text;
		},

		removeMarkers: function () {
			if (this.options.markers) {
				for (var i = 0; i < this.markers.length; i++) {
					this._map.removeLayer(this.markers[i]);
				}
				this.markers = [];
			}
		},

		showMarker: function (feature) {

			if (this.options.onMarkResult) {
				if (this.options.onMarkResult(feature)) return;
			}

			this.removeMarkers();

			var geo = [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];
			this._map.setView(geo, this._map.getZoom() || 8);

			var markerOptions = (typeof this.options.markers === 'object') ? this.options.markers : {};

			if (this.options.markers) {
				this.marker = new L.marker(geo, markerOptions).bindPopup(feature.properties.label); // eslint-disable-line new-cap
				this._map.addLayer(this.marker);
				this.markers.push(this.marker);
				this.marker.openPopup();
			}
		},

		setSelectedResult: function () {
			var selected = this._results.querySelectorAll('.leaflet-geocoderui-selected')[0];
			if (selected) {
				this._input.value = selected.innerText || selected.textContent;
				if (this.options.onSelectResult)
					this.options.onSelectResult(selected.feature);
			}
		},

		resetInput: function () {
			this._input.value = '';
			L.DomUtil.addClass(this._close, 'leaflet-geocoderui-hidden');
			this.removeMarkers();
			this._input.focus();
		},

		// TODO: Rename?
		clear: function () {
			this.clearResults();
			this._input.blur();
			if (this._input.value === '' && this._results.style.display !== 'none') {
				L.DomUtil.addClass(this._close, 'leaflet-geocoderui-hidden');
				this.collapse();
			}
		},

		clearResults: function () {
			// Hide results from view
			this._results.style.display = 'none';

			// Destroy contents if input has also cleared
			if (this._input.value === '') {
				this._results.innerHTML = '';
			}
		},

		expand: function () {
			L.DomUtil.addClass(this._container, 'leaflet-geocoderui-expanded');
			this.setFullWidth();
		},

		collapse: function () {
			// Does not collapse if search bar is always expanded
			if (this.options.expanded) {
				return;
			}

			L.DomUtil.removeClass(this._container, 'leaflet-geocoderui-expanded');
			this.clearFullWidth();
			this.clearResults();
		},

		// Set full width of expanded input, if enabled
		setFullWidth: function () {
			if (this.options.fullWidth) {
				// If fullWidth setting is a number, only expand if map container
				// is smaller than that breakpoint. Otherwise, clear width
				// Always ask map to invalidate and recalculate size first
				this._map.invalidateSize();
				var mapWidth = this._map.getSize().x;
				var touchAdjustment = L.DomUtil.hasClass(this._map._container, 'leaflet-touch');
				var width = mapWidth - FULL_WIDTH_MARGIN - (touchAdjustment ? FULL_WIDTH_TOUCH_ADJUSTED_MARGIN : 0);
				if (typeof this.options.fullWidth === 'number' && mapWidth >= window.parseInt(this.options.fullWidth, 10)) {
					this.clearFullWidth();
					return;
				}
				this._container.style.width = width.toString() + 'px';
			}
		},

		clearFullWidth: function () {
			// Clear set width, if any
			if (this.options.fullWidth) {
				this._container.style.width = '';
			}
		},

		onAdd: function (map) {
			var container = L.DomUtil.create('div',
				'leaflet-geocoderui-control leaflet-bar leaflet-control');

			this._body = document.body || document.getElementsByTagName('body')[0];
			this._container = container;
			this._input = L.DomUtil.create('input', 'leaflet-geocoderui-input', this._container);
			this._input.spellcheck = false;

			// Only set if title option is not null or falsy
			if (this.options.title) {
				this._input.title = this.options.title;
			}

			// Only set if placeholder option is not null or falsy
			if (this.options.placeholder) {
				this._input.placeholder = this.options.placeholder;
			}

			this._locate = L.DomUtil.create('a', 'leaflet-geocoderui-locate-icon', this._container);
			this._search = L.DomUtil.create('a', 'leaflet-geocoderui-search-icon', this._container);
			this._close = L.DomUtil.create('div', 'leaflet-geocoderui-close leaflet-geocoderui-hidden', this._container);
			this._close.innerHTML = '×';
			this._close.title = 'Close';

			this._results = L.DomUtil.create('div', 'leaflet-geocoderui-results leaflet-bar', this._container);

			if (this.options.expanded) {
				this.expand();
			}

			if (this.options.locate) {
				L.DomUtil.addClass(container, 'with-locate');
			}

			L.DomEvent
				.on(this._container, 'click', function (e) {
					// Other listeners should call stopProgation() to
					// prevent this from firing too greedily
					this._input.focus();
				}, this)
				.on(this._input, 'focus', function (e) {
					if (this._input.value) {
						this._results.style.display = 'block';
					}
				}, this)
				.on(this._map, 'click', function (e) {
					// Does what you might expect a _input.blur() listener might do,
					// but since that would fire for any reason (e.g. clicking a result)
					// what you really want is to blur from the control by listening to clicks on the map
					this.clear();
				}, this)
				.on(this._map, 'locationfound', function (e) {
					this._execute(this.geocoder.near, {
						lat: e.latlng.lat,
						lon: e.latlng.lng,
						accuracy: e.accuracy
					});
				}, this)
				.on(this._map, 'locationerror', function (err) {
					// this event is called in case of any location error
					// that is not a time out error.
					alert(err.message);
				}, this)
				.on(this._locate, 'click', function (e) {
					this._map.locate({
						watch: false,
						setView: false,
						timeout: 10000,
						enableHighAccuracy: true
					});
				}, this)
				.on(this._search, 'click', function (e) {
					L.DomEvent.stopPropagation(e);

					// If expanded option is true, just focus the input
					if (this.options.expanded === true) {
						this._input.focus();
						return;
					}

					// Toggles expanded state of container on click of search icon
					if (L.DomUtil.hasClass(this._container, 'leaflet-geocoderui-expanded')) {
						L.DomUtil.addClass(this._close, 'leaflet-geocoderui-hidden');
						this.collapse();
						this._input.blur();
					} else {
						if (this._input.value.length > 0) {
							L.DomUtil.removeClass(this._close, 'leaflet-geocoderui-hidden');
						}
						this.expand();
						this._input.focus();
					}
				}, this)
				.on(this._close, 'click', function (e) {
					this.resetInput();
					this.clearResults();
					L.DomEvent.stopPropagation(e);
				}, this)
				.on(this._input, 'keydown', function (e) {
					var list = this._results.querySelectorAll('.leaflet-geocoderui-result');
					var selected = this._results.querySelectorAll('.leaflet-geocoderui-selected')[0];
					var selectedPosition;
					var self = this;
					var panToPoint = function (shouldPan) {
						var _selected = self._results.querySelectorAll('.leaflet-geocoderui-selected')[0];
						if (_selected && shouldPan) {
							self.showMarker(_selected.feature);
						}
					};

					var scrollSelectedResultIntoView = function () {
						var _selected = self._results.querySelectorAll('.leaflet-geocoderui-selected')[0];
						var _selectedRect = _selected.getBoundingClientRect();
						var _resultsRect = self._results.getBoundingClientRect();
						// Is the selected element not visible?
						if (_selectedRect.bottom > _resultsRect.bottom) {
							self._results.scrollTop = _selected.offsetTop + _selected.offsetHeight - self._results.offsetHeight;
						} else if (_selectedRect.top < _resultsRect.top) {
							self._results.scrollTop = _selected.offsetTop;
						}
					};

					for (var i = 0; i < list.length; i++) {
						if (list[i] === selected) {
							selectedPosition = i;
							break;
						}
					}

					// TODO cleanup
					switch (e.keyCode) {
						// 13 = enter
						case 13:
							if (selected) {
								this.selectEntry(selected);
							} else {
								// perform a full text search on enter
								var text = (e.target || e.srcElement).value;
								this.search(text);
							}
							L.DomEvent.preventDefault(e);
							break;
						// 38 = up arrow
						case 38:
							// Ignore key if there are no results or if list is not visible
							if (!list || this._results.style.display === 'none') {
								return;
							}

							if (selected) {
								L.DomUtil.removeClass(selected, 'leaflet-geocoderui-selected');
							}

							var previousItem = list[selectedPosition - 1];

							if (selected && previousItem) {
								L.DomUtil.addClass(previousItem, 'leaflet-geocoderui-selected');
							} else {
								L.DomUtil.addClass(list[list.length - 1], 'leaflet-geocoderui-selected');
							}

							scrollSelectedResultIntoView();
							panToPoint(this.options.panToPoint);

							L.DomEvent.preventDefault(e);
							break;
						// 40 = down arrow
						case 40:
							// Ignore key if there are no results or if list is not visible
							if (!list || this._results.style.display === 'none') {
								return;
							}

							if (selected) {
								L.DomUtil.removeClass(selected, 'leaflet-geocoderui-selected');
							}

							var nextItem = list[selectedPosition + 1];

							if (selected && nextItem) {
								L.DomUtil.addClass(nextItem, 'leaflet-geocoderui-selected');
							} else {
								L.DomUtil.addClass(list[0], 'leaflet-geocoderui-selected');
							}

							scrollSelectedResultIntoView();
							panToPoint(this.options.panToPoint);

							L.DomEvent.preventDefault(e);
							break;
						// all other keys
						default:
							break;
					}
				}, this)
				.on(this._input, 'keyup', function (e) {
					var key = e.which || e.keyCode;
					var text = (e.target || e.srcElement).value;

					if (this._input.value.length > 0) {
						L.DomUtil.removeClass(this._close, 'leaflet-geocoderui-hidden');
					} else {
						L.DomUtil.addClass(this._close, 'leaflet-geocoderui-hidden');
					}

					// Ignore all further action if the keycode matches an arrow
					// key (handled via keydown event)
					if (key === 13 || key === 38 || key === 40) {
						return;
					}

					// keyCode 27 = esc key (esc should clear results)
					if (key === 27) {
						// If input is blank or results have already been cleared
						// (perhaps due to a previous 'esc') then pressing esc at
						// this point will blur from input as well.
						if (text.length === 0 || this._results.style.display === 'none') {
							this._input.blur();

							if (L.DomUtil.hasClass(this._container, 'leaflet-geocoderui-expanded')) {
								this.collapse();
								this.clearResults();
							}
						}
						// Clears results
						this._results.innerHTML = '';
						this._results.style.display = 'none';
						L.DomUtil.removeClass(this._search, 'leaflet-geocoderui-loading');
						return;
					}

					if (this._input.value !== this._lastValue) {
						this._lastValue = this._input.value;

						if (text.length >= this.options.minimumAutoCompleteInput && this.options.autocomplete === true) {
							this.autocomplete(text);
						} else {
							this.clearResults();
						}
					}
				}, this)
				.on(this._results, 'click', function (e) {
					L.DomEvent.preventDefault(e);
					L.DomEvent.stopPropagation(e);

					var _selected = this._results.querySelectorAll('.leaflet-geocoderui-selected')[0];
					if (_selected) {
						L.DomUtil.removeClass(_selected, 'leaflet-geocoderui-selected');
					}

					var selected = e.target || e.srcElement;
					/* IE8 */
					var findParent = function () {
						if (!L.DomUtil.hasClass(selected, 'leaflet-geocoderui-result')) {
							selected = selected.parentElement;
							if (selected) {
								findParent();
							}
						}
						return selected;
					};

					// click event can be registered on the child nodes
					// that does not have the required coords prop
					// so its important to find the parent.
					findParent();

					// If nothing is selected, (e.g. it's a message, not a result),
					// do nothing.
					if (selected) {
						L.DomUtil.addClass(selected, 'leaflet-geocoderui-selected');
						this.selectEntry(selected);
					}
				}, this)
				.on(this._results, 'mouseover', function (e) {
					// Prevent scrolling over results list from zooming the map, if enabled
					this._scrollWheelZoomEnabled = map.scrollWheelZoom.enabled();
					if (this._scrollWheelZoomEnabled) {
						map.scrollWheelZoom.disable();
					}
				}, this)
				.on(this._results, 'mouseout', function (e) {
					// Re-enable scroll wheel zoom (if previously enabled) after
					// leaving the results box
					if (this._scrollWheelZoomEnabled) {
						map.scrollWheelZoom.enable();
					}
				}, this);

			// Recalculate width of the input bar when window resizes
			if (this.options.fullWidth) {
				L.DomEvent.on(window, 'resize', function (e) {
					if (L.DomUtil.hasClass(this._container, 'leaflet-geocoderui-expanded')) {
						this.setFullWidth();
					}
				}, this);
			}

			// Collapse an empty input bar when user interacts with the map
			// Disabled if expanded is set to true
			if (!this.options.expanded) {
				L.DomEvent.on(this._map, 'mousedown', this._onMapInteraction, this);
				L.DomEvent.on(this._map, 'touchstart', this._onMapInteraction, this);
			}

			L.DomEvent.disableClickPropagation(this._container);
			if (map.attributionControl) {
				map.attributionControl.addAttribution(this.options.attribution);
			}
			return container;
		},

		_onMapInteraction: function (event) {
			if (!this._input.value) {
				this.collapse();
			}
		},

		onRemove: function (map) {
			map.attributionControl.removeAttribution(this.options.attribution);
		}
	});

	L.control.geocoder = function (apiKey, options) {
		return new L.Control.Geocoder(apiKey, options);
	};

	/*
	 * throttle Utility function (borrowed from underscore)
	 */
	function throttle(func, wait, options) {
		var context, args, result;
		var timeout = null;
		var previous = 0;
		if (!options) options = {};
		var later = function () {
			previous = options.leading === false ? 0 : new Date().getTime();
			timeout = null;
			result = func.apply(context, args);
			if (!timeout) context = args = null;
		};
		return function () {
			var now = new Date().getTime();
			if (!previous && options.leading === false) previous = now;
			var remaining = wait - (now - previous);
			context = this;
			args = arguments;
			if (remaining <= 0 || remaining > wait) {
				if (timeout) {
					clearTimeout(timeout);
					timeout = null;
				}
				previous = now;
				result = func.apply(context, args);
				if (!timeout) context = args = null;
			} else if (!timeout && options.trailing !== false) {
				timeout = setTimeout(later, remaining);
			}
			return result;
		};
	}

	/*
	 * escaping a string for regex Utility function
	 * from https://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
	 */
	function escapeRegExp(str) {
		return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
	}
}));
