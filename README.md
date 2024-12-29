# maplibre-geojson-tile
MapLibre で GeoJSON タイルを読み込む実装

https://mghs15.github.io/maplibre-geojson-tile/

地理院地図等で利用されている、タイル毎に分割された GeoJSON データ（GeoJSON タイル）を MapLibre GL JS の addProtocol() を用いて読み込む実装です。
内部的に GeoJSON データを Protocol buffers (mapbox vector tile) へ変換していま。

## 参考資料
* https://github.com/mapbox/vt-pbf/ 
  * 基本的に、このソースコードを流用しています。
* https://github.com/mapbox/pbf
* https://github.com/mapbox/geojson-vt
* 地理院地図/地理院タイル
* https://qiita.com/frogcat/items/b38b5e37535b65c5464b



