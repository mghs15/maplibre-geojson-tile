
// HTML で Pbf ライブラリの読込が必要
// https://github.com/mapbox/pbf
// ----------------------------------------------------------
// <script type="module">
//   import Pbf from 'https://cdn.jsdelivr.net/npm/pbf/+esm';
//   window.Pbf = Pbf;
// </script>
// ----------------------------------------------------------


/*******************************************************
// [vt-pbf] のソースコードを流用
// https://github.com/mapbox/vt-pbf/ 
********************************************************/

// vt-pbf/lib/geojson_wrapper.js

// conform to vectortile api
function GeoJSONWrapper (features, options) {
  this.options = options || {}
  this.features = features
  this.length = features.length
}

GeoJSONWrapper.prototype.feature = function (i) {
  return new FeatureWrapper(this.features[i], this.options.extent)
}

function FeatureWrapper (feature, extent) {
  this.id = typeof feature.id === 'number' ? feature.id : undefined
  this.type = feature.type
  this.rawGeometry = feature.type === 1 ? [feature.geometry] : feature.geometry
  this.properties = feature.tags
  this.extent = extent || 4096
}

FeatureWrapper.prototype.loadGeometry = function () {
  var rings = this.rawGeometry
  this.geometry = []

  for (var i = 0; i < rings.length; i++) {
    var ring = rings[i]
    var newRing = []
    for (var j = 0; j < ring.length; j++) {
      newRing.push({x: ring[j][0], y: ring[j][1]}) 
      // ここは new Point(x,y) から {x:x,y:y} へ変更した
    }
    this.geometry.push(newRing)
  }
  return this.geometry
}


// vt-pbf/index.js

/**
 * Serialize a vector-tile-js-created tile to pbf
 *
 * @param {Object} tile
 * @return {Buffer} uncompressed, pbf-serialized tile data
 */
function fromVectorTileJs (tile) {
  var out = new Pbf()
  writeTile(tile, out)
  return out.finish()
}

/**
 * Serialized a geojson-vt-created tile to pbf.
 *
 * @param {Object} layers - An object mapping layer names to geojson-vt-created vector tile objects
 * @param {Object} [options] - An object specifying the vector-tile specification version and extent that were used to create `layers`.
 * @param {Number} [options.version=1] - Version of vector-tile spec used
 * @param {Number} [options.extent=4096] - Extent of the vector tile
 * @return {Buffer} uncompressed, pbf-serialized tile data
 */
function fromGeojsonVt (layers, options) {
  options = options || {}
  var l = {}
  for (var k in layers) {
    l[k] = new GeoJSONWrapper(layers[k].features, options)
    l[k].name = k
    l[k].version = options.version
    l[k].extent = options.extent
  }
  return fromVectorTileJs({ layers: l })
}

function writeTile (tile, pbf) {
  for (var key in tile.layers) {
    pbf.writeMessage(3, writeLayer, tile.layers[key])
  }
}

function writeLayer (layer, pbf) {
  pbf.writeVarintField(15, layer.version || 1)
  pbf.writeStringField(1, layer.name || '')
  pbf.writeVarintField(5, layer.extent || 4096)

  var i
  var context = {
    keys: [],
    values: [],
    keycache: {},
    valuecache: {}
  }

  for (i = 0; i < layer.length; i++) {
    context.feature = layer.feature(i)
    pbf.writeMessage(2, writeFeature, context)
  }

  var keys = context.keys
  for (i = 0; i < keys.length; i++) {
    pbf.writeStringField(3, keys[i])
  }

  var values = context.values
  for (i = 0; i < values.length; i++) {
    pbf.writeMessage(4, writeValue, values[i])
  }
}

function writeFeature (context, pbf) {
  var feature = context.feature

  if (feature.id !== undefined) {
    pbf.writeVarintField(1, feature.id)
  }

  pbf.writeMessage(2, writeProperties, context)
  pbf.writeVarintField(3, feature.type)
  pbf.writeMessage(4, writeGeometry, feature)
}

function writeProperties (context, pbf) {
  var feature = context.feature
  var keys = context.keys
  var values = context.values
  var keycache = context.keycache
  var valuecache = context.valuecache

  for (var key in feature.properties) {
    var value = feature.properties[key]

    var keyIndex = keycache[key]
    if (value === null) continue // don't encode null value properties

    if (typeof keyIndex === 'undefined') {
      keys.push(key)
      keyIndex = keys.length - 1
      keycache[key] = keyIndex
    }
    pbf.writeVarint(keyIndex)

    var type = typeof value
    if (type !== 'string' && type !== 'boolean' && type !== 'number') {
      value = JSON.stringify(value)
    }
    var valueKey = type + ':' + value
    var valueIndex = valuecache[valueKey]
    if (typeof valueIndex === 'undefined') {
      values.push(value)
      valueIndex = values.length - 1
      valuecache[valueKey] = valueIndex
    }
    pbf.writeVarint(valueIndex)
  }
}

function command (cmd, length) {
  return (length << 3) + (cmd & 0x7)
}

function zigzag (num) {
  return (num << 1) ^ (num >> 31)
}

function writeGeometry (feature, pbf) {
  var geometry = feature.loadGeometry()
  var type = feature.type
  var x = 0
  var y = 0
  var rings = geometry.length
  for (var r = 0; r < rings; r++) {
    var ring = geometry[r]
    var count = 1
    if (type === 1) {
      count = ring.length
    }
    pbf.writeVarint(command(1, count)) // moveto
    // do not write polygon closing path as lineto
    var lineCount = type === 3 ? ring.length - 1 : ring.length
    for (var i = 0; i < lineCount; i++) {
      if (i === 1 && type !== 1) {
        pbf.writeVarint(command(2, lineCount - 1)) // lineto
      }
      var dx = ring[i].x - x
      var dy = ring[i].y - y
      pbf.writeVarint(zigzag(dx))
      pbf.writeVarint(zigzag(dy))
      x += dx
      y += dy
    }
    if (type === 3) {
      pbf.writeVarint(command(7, 1)) // closepath
    }
  }
}

function writeValue (value, pbf) {
  var type = typeof value
  if (type === 'string') {
    pbf.writeStringField(1, value)
  } else if (type === 'boolean') {
    pbf.writeBooleanField(7, value)
  } else if (type === 'number') {
    if (value % 1 !== 0) {
      pbf.writeDoubleField(3, value)
    } else if (value < 0) {
      pbf.writeSVarintField(6, value)
    } else {
      pbf.writeVarintField(5, value)
    }
  }
}


/*******************************************************
// MapLibre - addProtocol 関係設定
********************************************************/

const processGeojsonTile = async (params) => {

  //console.log(params);
  const pbf = new Pbf();
  
  // URL は geojson-tile://maxNativeZoom=2;https://～～～/{z}/{x}/{y}.geojson を想定
  // 同じデータに何度もアクセスするため、ブラウザのキャッシュを頼ることになる
  const info = params.url.split("https://");
  const url = "https://" + info[1];
  const add = info[0].replace("geojson-tile://", "");
  
  //console.log(url, add);
  
  const m = url.match(/\/(\d+)\/(\d+)\/(\d+)\.geojson/);
  const [z, x, y] = [+m[1], +m[2], +m[3]];
  //console.log(x, y, z);
  
  // URL に組み込まれるパラメータは maxNativeZoom しかないことを想定
  // 他のパラメータを組み込む場合、取得方法の変更が必要
  const q = add.split(";")[0];
  const maxNativeZoom = q ? +q.split("=")[1] || z : z;
  
  const dz = (maxNativeZoom < z) ? z - maxNativeZoom : 0;
  const nativeZ = z - dz;
  const nativeX = x >> dz;
  const nativeY = y >> dz;
  const nativeUrl = url.replace(/\/(\d+)\/(\d+)\/(\d+)\.geojson/, `/${nativeZ}/${nativeX}/${nativeY}.geojson`);
  //console.log(dz, `/${nativeZ}/${nativeX}/${nativeY}`);
  //console.log(nativeUrl);
  
  const geoJSON = await fetch(nativeUrl)
    .then((response) => {
        return response.json();
    });
  
  const tileIndex = geojsonvt(geoJSON, {
    generateId: true,
    indexMaxZoom: z,
    maxZoom: z, 
  });
  
  //console.log(tileIndex);
  const tile = tileIndex.getTile(z, x, y);
  //console.log(tile);
  
  return new Promise((resolve) => {
    const buffer = fromGeojsonVt({ "v": tile })
    resolve(buffer);
    
  });
  
}

if(!maplibregl) alert("MapLibre GL JS が読み込まれていません");

maplibregl.addProtocol('geojson-tile', async (params, abortController) => {
  
  const arrayBuffer = await processGeojsonTile(params)
    .then((arrayBuffer) => {
      return arrayBuffer;
    })
  
  return {data: arrayBuffer}
  
});


