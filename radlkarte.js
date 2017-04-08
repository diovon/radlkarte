"use strict";

var rkGlobal = {}; // global variable for radlkarte properties / data storage
rkGlobal.leafletMap = undefined; // the main leaflet map
rkGlobal.leafletLayersControl = undefined; // leaflet layer-control
rkGlobal.segmentsPS = []; // matrix holding all segments (two dimensions: priority & stressfulness)
rkGlobal.markerLayer = L.layerGroup(); // layer group holding all icons to be viewed at higher zoom levels
rkGlobal.priorityStrings = ["Überregional", "Regional", "Lokal"]; // names of all different levels of priorities (ordered descending by priority)
rkGlobal.stressStrings = ["Ruhig", "Durchschnittlich", "Stressig"];
rkGlobal.debug = true; // debug output will be logged if set to true
rkGlobal.styleFunction = updateStylesWithStyleA;

function debug(obj) {
    if(rkGlobal.debug)
        console.log(obj);
}

function loadGeoJson() {
    // get rid of "XML Parsing Error: not well-formed" during $.getJSON
    $.ajaxSetup({
        beforeSend: function (xhr) {
            if (xhr.overrideMimeType) {
                xhr.overrideMimeType("application/json");
            }
        }
    });
    $.getJSON("data/radlkarte-at-vienna.min.geojson", function(data) {
        var i, j; // loop counter
        var p, s; // priority / stressfulness
        
        if(data.type != "FeatureCollection")    {
            console.error("expected a GeoJSON FeatureCollection. no radlkarte network can be displayed.");
            return;
        }
        
        // prepare matrix
        for(i=0; i<rkGlobal.priorityStrings.length; i++) {
            rkGlobal.segmentsPS[i] = [];
            for(j=0; j<rkGlobal.stressStrings.length; j++)
                rkGlobal.segmentsPS[i][j] = {lines: [], decorators: []};
        }
        
        // first step - collect geojson linestring features in the matrix 
        var ignoreCount = 0;
        var goodCount = 0;
        for (i=0; i<data.features.length; i++) {
            var geojson = data.features[i];
            if(geojson.type != 'Feature' || geojson.properties == undefined || geojson.geometry == undefined || geojson.geometry.type != 'LineString' || geojson.geometry.coordinates.length < 2) {
                if(geojson.geometry.type == 'Point') {
                    var icon = getIcon(geojson.properties);
                    if(icon != undefined) {
                        rkGlobal.markerLayer.addLayer(L.marker(L.geoJSON(geojson).getLayers()[0].getLatLng(), {icon: icon}));
                    }
                } else {
                    console.warn("ignoring invalid object (not a proper linestring feature): " + JSON.stringify(geojson));
                    ++ignoreCount;
                }
                continue;
            }
            
            p = parseInt(geojson.properties.p, 10);
            s = parseInt(geojson.properties.s, 10);
            if(isNaN(p) || isNaN(s)) {
                console.warn("ignoring invalid object (priority / stressfulness not set): " + JSON.stringify(geojson));
                ++ignoreCount;
                continue;
            }
            
            // 1) for the lines: add geojson linestring features
            rkGlobal.segmentsPS[p][s].lines.push(geojson);
            
            // 2) for the decorators: add latlons
            if(geojson.properties.oneway == 'yes') {
                rkGlobal.segmentsPS[p][s].decorators.push(turf.flip(geojson).geometry.coordinates);
            }
            
            ++goodCount;
        }
        debug("processed " + goodCount + " valid LineString Features and " + ignoreCount + " ignored objects");
        
        // second step - merge the geojson linestring features for the same priority-stressfulness level into a single multilinestring
        // and then put them in a leaflet layer
        for(p in rkGlobal.segmentsPS) {
            for(s in rkGlobal.segmentsPS[p]) {
                var multilinestringfeature = turf.combine(turf.featureCollection(rkGlobal.segmentsPS[p][s].lines));
                rkGlobal.segmentsPS[p][s].lines = L.geoJSON(multilinestringfeature);
                rkGlobal.leafletMap.addLayer(rkGlobal.segmentsPS[p][s].lines);
                
                if(rkGlobal.segmentsPS[p][s].decorators.length > 0) {
                    rkGlobal.segmentsPS[p][s].decorators = L.polylineDecorator(rkGlobal.segmentsPS[p][s].decorators);
                    rkGlobal.leafletMap.addLayer(rkGlobal.segmentsPS[p][s].decorators);
                } else {
                    rkGlobal.segmentsPS[p][s].decorators = undefined;
                }
                // discard properties of multilinestringfeature? no longer needed.
            }
        }
        
        // layer sorting (high priority on top)
        for(p in rkGlobal.segmentsPS) {
            for(s in rkGlobal.segmentsPS[p]) {
                rkGlobal.segmentsPS[p][s].lines.bringToBack();
                if(rkGlobal.segmentsPS[p][s].decorators != undefined)
                    rkGlobal.segmentsPS[p][s].decorators.bringToBack();
            }
        }
        
        rkGlobal.styleFunction();
        
        // add to map & layercontrol
//         for(var priority=rkGlobal.priorityStrings.length-1; priority>= 0; priority--) {
//             rkGlobal.segments.priority[priority].all.addTo(rkGlobal.leafletMap);
//             rkGlobal.leafletLayersControl.addOverlay(rkGlobal.segments.priority[priority].all, rkGlobal.priorityStrings[priority]);
//         }
        
        rkGlobal.leafletMap.on('zoomend', function(ev) {
            debug("restyling - changed zoom level to " + rkGlobal.leafletMap.getZoom());
            rkGlobal.styleFunction();
        });
    });
}


// ----------------- begin of style A: stressfulness = color, priority = line width

rkGlobal.tileLayerOpacity = 1;
rkGlobal.styleAPriorityFullVisibleFromZoom = [0, 14, 15];
rkGlobal.styleAPriorityReducedVisibilityFromZoom = [0, 12, 14];
rkGlobal.styleAIconZoomThreshold = 14;
rkGlobal.styleALineWidthFactor = [1.4, 0.5, 0.5];
rkGlobal.styleAArrowWidthFactor = [2, 3, 3];
rkGlobal.styleAOpacity = 0.62;
// rkGlobal.styleAColors = ['#004B67', '#FF6600', '#F00']; // blue - orange - red
//rkGlobal.styleAColors = ['#004B67', '#51A4B6', '#51A4B6']; // dark blue - light blue
//rkGlobal.styleAColors = ['#004B67', '#004B67', '#FF6600']; // blue - blue - orange
//rkGlobal.styleAColors = ['#51A4B6', '#FF6600', '#ff0069']; // blue - orange - voilet
rkGlobal.styleAColors = ['#004B67', '#51A4B6', '#FF6600']; // dark blue - light blue - orange

/**
 * Updates the styles of all layers. Takes current zoom level into account
 */
function updateStylesWithStyleA() {
    if(rkGlobal.leafletMap.getZoom() >= rkGlobal.styleAIconZoomThreshold) {
        rkGlobal.leafletMap.addLayer(rkGlobal.markerLayer);
    } else {
        rkGlobal.leafletMap.removeLayer(rkGlobal.markerLayer);
    }
    for(var priority=0; priority<rkGlobal.priorityStrings.length; priority++) {
        for(var stressfulness=0; stressfulness<rkGlobal.stressStrings.length; stressfulness++) {
            if(rkGlobal.leafletMap.getZoom() >= rkGlobal.styleAPriorityFullVisibleFromZoom[priority]) {
                rkGlobal.leafletMap.addLayer(rkGlobal.segmentsPS[priority][stressfulness].lines);
                rkGlobal.segmentsPS[priority][stressfulness].lines.setStyle(getLineStringStyleWithColorDefiningStressfulness(priority, stressfulness));
                if(rkGlobal.segmentsPS[priority][stressfulness].decorators != undefined) {
                    rkGlobal.segmentsPS[priority][stressfulness].decorators.setPatterns(getOnewayArrowPatternsWithColorDefiningStressfulness(priority, stressfulness));
                    rkGlobal.leafletMap.addLayer(rkGlobal.segmentsPS[priority][stressfulness].decorators);
                }
            } else if(rkGlobal.leafletMap.getZoom() < rkGlobal.styleAPriorityFullVisibleFromZoom[priority] && rkGlobal.leafletMap.getZoom() >= rkGlobal.styleAPriorityReducedVisibilityFromZoom[priority]) {
                rkGlobal.segmentsPS[priority][stressfulness].lines.setStyle(getLineStringStyleWithColorDefiningStressfulnessMinimal(priority,stressfulness));
                rkGlobal.leafletMap.addLayer(rkGlobal.segmentsPS[priority][stressfulness].lines);
                if(rkGlobal.segmentsPS[priority][stressfulness].decorators != undefined) {
                    rkGlobal.leafletMap.removeLayer(rkGlobal.segmentsPS[priority][stressfulness].decorators);
                }
            } else {
                rkGlobal.leafletMap.removeLayer(rkGlobal.segmentsPS[priority][stressfulness].lines);
            }
        }
    }
}

function getLineStringStyleWithColorDefiningStressfulness(priority,stressfulness) {
    var style = {
        color: rkGlobal.styleAColors[stressfulness],
        weight: getLineWeightForCategory(priority),
        opacity: rkGlobal.styleAOpacity
    };
//     if(priority >= 2)
//         style.dashArray = "5 10";
    return style;
}

function getLineWeightForCategory(category) {
    var lineWeight = rkGlobal.leafletMap.getZoom() - 10;
    lineWeight = (lineWeight <= 0 ? 1 : lineWeight) * 1.4;
    lineWeight *= rkGlobal.styleALineWidthFactor[category];
    return lineWeight;
}

function getLineStringStyleWithColorDefiningStressfulnessMinimal(priority,stressfulness) {
    var style = {
        color: rkGlobal.styleAColors[stressfulness],
        weight: 1,
        opacity: rkGlobal.styleAOpacity
    };
//     if(priority >= 2)
//         style.dashArray = "5 10";
    return style;
}

/**
 * @return an array of patterns as expected by L.PolylineDecorator.setPatterns
 */ 
function getOnewayArrowPatternsWithColorDefiningStressfulness(priority, stressfulness) {
    var arrowWidth = Math.max(5, getLineWeightForCategory(priority) * rkGlobal.styleAArrowWidthFactor[priority]);
    return [
    {
        offset: 25,
        repeat: 50,
        symbol: L.Symbol.arrowHead({
            pixelSize: arrowWidth,
            headAngle: 90,
            pathOptions: {
                color: rkGlobal.styleAColors[stressfulness],
                fillOpacity: rkGlobal.styleAOpacity,
                weight: 0
            }
        })
    }
    ];
}


// ----------------- end of style A

function initMap() {
    rkGlobal.leafletMap = L.map('map', { 'zoomControl' : false } ).setView([48.2083537, 16.3725042], 14);
    new L.Hash(rkGlobal.leafletMap);

    var mapboxStreets = L.tileLayer('https://api.tiles.mapbox.com/v4/mapbox.streets/{z}/{x}/{y}.png?access_token={accessToken}', {
        maxZoom: 18,
        attribution: 'map data &copy; <a href="http://openstreetmap.org" target="_blank">OpenStreetMap</a> contributors, imagery &copy; <a href="http://mapbox.com" target="_blank">Mapbox</a>',
        accessToken: 'pk.eyJ1IjoiZHRzLWFpdCIsImEiOiJjaW1kbmV5NjIwMDI1dzdtMzBweW14cmZjIn0.VraboGeyXnUjm1e7xWDWbA',
        opacity: rkGlobal.tileLayerOpacity
    });
    var mapboxSatellite = L.tileLayer('https://api.tiles.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.png?access_token={accessToken}', {
        maxZoom: 18,
        attribution: 'imagery © <a href="http://mapbox.com" target="_blank">Mapbox</a>',
        accessToken: 'pk.eyJ1IjoiZHRzLWFpdCIsImEiOiJjaW1kbmV5NjIwMDI1dzdtMzBweW14cmZjIn0.VraboGeyXnUjm1e7xWDWbA'
    });
    var ocm = L.tileLayer('https://{s}.tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=ab5e4b2d24854fefb139c538ef5187a8', {
        maxZoom: 18,
        attribution: 'map data &copy; <a href="http://openstreetmap.org" target="_blank">OpenStreetMap</a> contributors, imagery &copy; <a href="http://www.thunderforest.com" target="_blank">Thunderforest</a>'
    });
    var osm = L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: 'map data &amp; imagery &copy; <a href="http://openstreetmap.org" target="_blank">OpenStreetMap</a> contributors'
    });
    var empty = L.tileLayer('', {attribution: ''});
    
    var baseMaps = {
        "OpenStreetMap (Mapbox)": mapboxStreets,
        "Satellitenbild (Mapbox)": mapboxSatellite,
        "OpenCycleMap": ocm,
        "OpenStreetMap": osm,
        "Leer": empty,
    };
    var overlayMaps = {};
    
    mapboxStreets.addTo(rkGlobal.leafletMap);
    rkGlobal.leafletLayersControl = L.control.layers(baseMaps, overlayMaps, { 'position' : 'topright', 'collapsed' : true } ).addTo(rkGlobal.leafletMap);
    
    var geocodingControl = L.Control.geocoder({
        position: 'topright',
        placeholder: 'Adresssuche',
        errorMessage: 'Leider nicht gefunden',
        geocoder: L.Control.Geocoder.nominatim({
            geocodingQueryParams: {
                countrycodes: 'at',
                viewbox: [16.1, 48.32, 16.65, 48] //viewbox=<left>,<top>,<right>,<bottom>
            }
        }),
        defaultMarkGeocode: false
    }).on('markgeocode', function(e) {
        var result = e.geocode || e;
        var bbox = result.bbox;
        var poly = L.polygon([
            bbox.getSouthEast(),
            bbox.getNorthEast(),
            bbox.getNorthWest(),
            bbox.getSouthWest()
        ]);
        rkGlobal.leafletMap.fitBounds(poly.getBounds());
        var popup = L.popup({
            autoClose: false,
            closeOnClick: false,
            closeButton: true
        }).setLatLng(e.geocode.center).setContent(result.html || result.name).openOn(rkGlobal.leafletMap);
    }).addTo(rkGlobal.leafletMap);
    
    
    var locateControl = L.control.locate({
        position: 'topright',
        setView: 'always',
        flyTo: true,
        locateOptions: {
            enableHighAccuracy: true,
            watch: true
        },
        strings: {
            title: 'Verfolge aktuelle Position'
        }
    }).addTo(rkGlobal.leafletMap);
    
    L.control.zoom({position: 'topright'}).addTo(rkGlobal.leafletMap);
    
    var sidebar = L.control.sidebar('sidebar').addTo(rkGlobal.leafletMap);
    
    initializeIcons();
    
    // load overlay
    loadGeoJson();
}

function initializeIcons() {
    rkGlobal.icons = {};
    rkGlobal.icons.dismount = L.icon({
        iconUrl: 'css/dismount.svg',
        iconSize:     [33, 29], 
        iconAnchor:   [16.5, 14.5], 
        popupAnchor:  [0, 0]
    });
    rkGlobal.icons.noCargo = L.icon({
        iconUrl: 'css/nocargo.svg',
        iconSize:     [29, 29], 
        iconAnchor:   [14.5, 14.5], 
        popupAnchor:  [0, 0]
    });
    rkGlobal.icons.noCargoAndDismount = L.icon({
        iconUrl: 'css/nocargo+dismount.svg',
        iconSize:     [57.7, 29], 
        iconAnchor:   [28.85, 14.5], 
        popupAnchor:  [0, 0]
    });
}

/**
 * @param properties GeoJSON properties of a point
 * @return an matching icon or undefined if no icon should be used
 */
function getIcon(properties) {
    var dismount = properties.dismount == 'yes';
    var nocargo = properties.nocargo == 'yes';
    
    if(dismount && nocargo)
        return rkGlobal.icons.noCargoAndDismount;
    else if(dismount)
        return rkGlobal.icons.dismount;
    else if(nocargo)
        return rkGlobal.icons.noCargo;
    return undefined;
}
