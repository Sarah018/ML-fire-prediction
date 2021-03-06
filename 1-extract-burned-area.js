// The javascript code can be accessed through Google Earth Engine cloud computing platform at:
// https://code.earthengine.google.com/61be378aeafbe9bd100c547039938a94

// The code is as follows:
var snow = ee.ImageCollection("MODIS/006/MOD10A1"),
    burn = ee.ImageCollection("MODIS/006/MCD64A1"),
    geometry = /* color: #d63000 */ee.Geometry.MultiPoint(),
    DEM = ee.Image("USGS/GMTED2010");
    
      
var burnedArea = burn.select('BurnDate').filter(ee.Filter.date('2017-01-01', '2021-10-01'));
var burnedAreaVis = {
  min: 30.0,
  max: 341.0,
  palette: ['4e0400', '951003', 'c61503', 'ff1901'],
};
Map.setCenter(6.746, 46.529, 2);
Map.addLayer(burnedArea, burnedAreaVis, 'Burned Area');

var roi = /* color: #bf04c2 */ee.Geometry.Polygon(
        [[[-180, 90],
          [0, 90],
          [180, 90],
          [180, -90],
          [0, -90],
          [-180, -90]]], null, false);
var qc_band_name = 'NDSI_Snow_Cover_Basic_QA';
var snow_band_name = "NDSI_Snow_Cover";
var albedo_band_name = 'NDSI_Snow_Cover_Class';
var burn_band_name = 'BurnDate';
var uncertainty_band_name = 'Uncertainty';
var qa_band_name = 'QA';
var baseDate = ee.Date("2000-1-1");
// var roi = worldGrid.filterBounds(point);
// Map.centerObject(roi, 8);

// Function for iteraton over the range of dates
function day_mosaics(date, newlist, rawImgCol) {
  // Cast
  date = ee.Date(date);
  newlist = ee.List(newlist);
  // Filter collection between date and the next day
  var filtered = rawImgCol.filterDate(date, date.advance(1,'day'));
  // Make the mosaic
  var image = ee.Image(filtered.mosaic());
  image = image.set("system:time_start", date.millis());
  image = image.set("system:index", date.format("yyyy_MM_dd"));
  // Add the mosaic to a list only if the collection has images
  return ee.List(ee.Algorithms.If(filtered.size(), newlist.add(image), newlist));
}


function getGoodSnow(startDate, endDate) {
  var days = endDate.difference(startDate, "day");
  var dayList = ee.List.sequence(0, days.subtract(1));
  var imgList = dayList.map(function(day){
    day = ee.Number(day);
    var curDate = startDate.advance(day, "day");
    var nextDate = curDate.advance(1, "day");
    var img = snow.filterDate(curDate, nextDate)
                  .select([snow_band_name, qc_band_name, albedo_band_name])
                  .first();
    //only best QA value/all values without quality control
    var snowImg = null;
    var constant_img = ee.Image.constant([0, 0, 0])
                        .select(["constant_0","constant_1","constant_2"], [snow_band_name, qc_band_name, albedo_band_name])
                        .toByte();
    constant_img = constant_img.updateMask(constant_img.select(qc_band_name));
    
    //only include data of good quality
    snowImg = ee.Algorithms.If(
      // Good Quality
      img,
      img.updateMask(img.select(qc_band_name).eq(0)),
      constant_img
    );
    
    snowImg = ee.Image(snowImg);
    snowImg = snowImg.set("system:time_start", curDate.millis());
    snowImg = snowImg.set("system:index", curDate.format("yyyy_MM_dd"));
    return snowImg;
  });
  var imgCol = ee.ImageCollection.fromImages(imgList);
  return imgCol;
}

function getMosaicSnow(imgCol, startDate, endDate) {
  var diff = endDate.difference(startDate, 'day');
  // Make a list of all dates
  var range = ee.List.sequence(0, diff.subtract(1))
                .map(function(day){
                  return startDate.advance(day,'day');
                }); 
  // Iterate over the range to make a new list, and then cast the list to an imagecollection
  var snowList = range.iterate(function(date, newlist) {
    return day_mosaics(date, newlist, imgCol);
  }, ee.List([]));
  var MosaicSnow = ee.ImageCollection(ee.List(snowList));
  return MosaicSnow;
}


function getGoodBurn(startDate, endDate) {
  var burnImgCol = burn.filterDate(startDate, endDate)
                      .map(function(image){
                        var time_start = image.get("system:time_start");
                        var year = ee.Number(ee.Date(time_start).get("year")).toInt();
                        var mask = image.select(uncertainty_band_name).lt(30)
                                        .and(image.select(qa_band_name).bitwiseAnd(3).eq(3));
                        image = image.select(burn_band_name)
                                     .updateMask(mask);
                        var diffDays = ee.Date.fromYMD(year, 1, 1)
                                         .difference(baseDate, "day");
                        image = image.add(diffDays).toDouble();
                        image = image.set("system:time_start", time_start);
                        return image;
                      });
  return burnImgCol;
}

/////////////////////////////////////////////

function calcYearSnowPersistence(startDate, endDate) {
  var startYear = ee.Number(startDate.get("year")).toInt();
  var endYear = ee.Number(endDate.get("year")).toInt();
  var yearList = ee.List.sequence(startYear, endYear.subtract(1));
  var yearImageList = yearList.map(function(year) {
    year = ee.Number(year).toInt();
    var sdate = ee.Date.fromYMD(year, 10, 1);
    var edate = ee.Date.fromYMD(year.add(1), 10, 1);
    var yearImgCol = getGoodSnow(sdate, edate);
    yearImgCol = getMosaicSnow(yearImgCol, sdate, edate);
    yearImgCol = yearImgCol.select(snow_band_name);
    var total = yearImgCol.count();
    var useful = yearImgCol.map(function(image) {
      return image.gt(0);
    }).sum();
    var image = useful.divide(total).multiply(100.0).toDouble();   
    image = image.set("year", year);
    return image;
  });
  var yearImgCol = ee.ImageCollection.fromImages(yearImageList);
  return yearImgCol;
}


function calcMeanSnowPersistence(yearImgCol) {
  var image = yearImgCol.mean();
  return image;
}








function fireMask(image, MosaicFire) {

  var constantImage = ee.Image.constant(100).toByte();

  var fireImage = MosaicFire.count().gt(0)
  var maskImage = ee.Image.constant(1).toByte();
  var mask = ee.Algorithms.If(
    fireImage, 
    fireImage.select("BurnDate").gt(0),
    // fireImage.select("FireMask").eq(highFire),      
    ee.Image.constant(0).toByte()
  );
  maskImage = maskImage.where(ee.Image(mask), 0);
  var image2=constantImage.updateMask(maskImage);
  return image2
}




function exportCSV(fireImage,  name, bandName) {
  Map.addLayer(fireImage.select(bandName), {palette: "red"}, "fireImage2");
  var dataDict = fireImage.reduceRegion({
    reducer: ee.Reducer.toList(),
    geometry: roi,
    scale: 1000,
    maxPixels: 1e13,
    tileScale: 16
  });
  // print("dataDict", dataDict);
  
  var fireList = ee.List(dataDict.get("bandName"));
  var latList = ee.List(dataDict.get("latitude"));
  var lonList = ee.List(dataDict.get("longitude"));
  var indexList = ee.List.sequence(0, fireList.length().subtract(1));
  var fList = indexList.map(function(index) {
    index = ee.Number(index).toInt();
    var _fire = fireList.get(index);
    var _lat = latList.get(index);
    var _lon = lonList.get(index);
    return ee.Feature(null, {
      index: index,
      fire: _fire,
      lat: _lat,
      lon: _lon
    });
  });
  var fcol = ee.FeatureCollection(fList);
  // print(fcol);
  Export.table.toDrive({
    collection: fcol,
    description: "Drive-burnCSV-"+name,
    fileNamePrefix: "burnCSV-"+name,
    fileFormat: "CSV"
  });
}

//  Calculate snow possibility
function main1() {
var startDate = ee.Date("2018-10-1");
var endDate = ee.Date("2019-10-1");
var imgCol = calcYearSnowPersistence(startDate, endDate) ;
// var img = calcMeanSnowPersistence(imgCol);
var img = imgCol.first();
print(img)
  Export.image.toAsset({
    image: img,
    description: "Asset-SnowPers20181001to20191001-", 
    assetId: "SnowPers20181001to20191001",
    region: roi,
    scale: 500,
    crs: "EPSG:4326",
    maxPixels: 1e13
  });
}

//  Get seasonal snow areas
function main2() {
  var name1 = 'SnowPers20001001to20011001';
  var name2 = 'SnowPers20011001to20021001';
  var name3 = 'SnowPers20021001to20031001';
  var name4 = 'SnowPers20031001to20041001';
  var name5 = 'SnowPers20041001to20051001';
  var name6 = 'SnowPers20051001to20061001';
  var name7 = 'SnowPers20061001to20071001';
  var name8 = 'SnowPers20071001to20081001';
  var name9 = 'SnowPers20081001to20091001';
  var name10 = 'SnowPers20091001to20101001';
  var name11 = 'SnowPers20101001to20111001';
  var name12 = 'SnowPers20111001to20121001';
  var name13 = 'SnowPers20121001to20131001';
  var name14 = 'SnowPers20131001to20141001';
  var name15 = 'SnowPers20141001to20151001';
  var name16 = 'SnowPers20151001to20161001';
  var name17 = 'SnowPers20161001to20171001';
  var name18 = 'SnowPers20171001to20181001';
  var name19 = 'SnowPers20181001to20191001';
  
  var image1 = ee.Image("users/yunxiaz1/burnSnow/"+name1);
  var image2 = ee.Image("users/yunxiaz1/burnSnow/"+name2);
  var image3 = ee.Image("users/yunxiaz1/burnSnow/"+name3);
  var image4 = ee.Image("users/yunxiaz1/burnSnow/"+name4);
  var image5 = ee.Image("users/yunxiaz1/burnSnow/"+name5);
  var image6 = ee.Image("users/yunxiaz1/burnSnow/"+name6);
  var image7 = ee.Image("users/yunxiaz1/burnSnow/"+name7);
  var image8 = ee.Image("users/yunxiaz1/burnSnow/"+name8);
  var image9 = ee.Image("users/yunxiaz1/burnSnow/"+name9);
  var image10 = ee.Image("users/yunxiaz1/burnSnow/"+name10);
  var image11 = ee.Image("users/yunxiaz1/burnSnow/"+name11);
  var image12 = ee.Image("users/yunxiaz1/burnSnow/"+name12);
  var image13 = ee.Image("users/yunxiaz1/burnSnow/"+name13);
  var image14 = ee.Image("users/yunxiaz1/burnSnow/"+name14);
  var image15 = ee.Image("users/yunxiaz1/burnSnow/"+name15);
  var image16 = ee.Image("users/yunxiaz1/burnSnow/"+name16);
  var image17 = ee.Image("users/yunxiaz1/burnSnow/"+name17);
  var image18 = ee.Image("users/yunxiaz1/burnSnow/"+name18);
  var image19 = ee.Image("users/yunxiaz1/burnSnow/"+name19);
  
  var imgCol = ee.ImageCollection([image1, image2, image3, image4, image5,
                                  image6,image7,image8, image9, image10, image11, 
                                  image12, image13, image14,
                                  image15, image16, image17, image18, image19]);
  var meanSnowPersImage = imgCol.mean();
  var SeasonalSnowArea = meanSnowPersImage.updateMask(meanSnowPersImage.gt(0));

  Export.image.toAsset({
    image: SeasonalSnowArea,
    description: "Asset-SnowArea20001001to20191001_2", 
    assetId: "burnSnow/SnowArea20001001to20191001_2",
    region: roi,
    scale: 1000,
    crs: "EPSG:4326",
    maxPixels: 1e13
  });
  
}

// Get BurnDate
function main3() {
  
  var images = burn.filterDate("2000-10-1", "2020-10-1").select("BurnDate")
  // get the pixel where fire only occured once
  var number_unmasked_pixels = images.count().eq(1)
  
  
  var startDate = ee.Date("2005-10-1");
  var endDate = ee.Date("2006-10-1");
  var burnName = '20051001to20061001WithLonLat'
  var snowName = 'SnowArea20001001to20191001_2';
  var snowAreaImg = ee.Image("users/yunxiaz1/burnSnow/"+snowName);
  var burns = getGoodBurn(startDate, endDate);
  burns = burns.map(function(image) {
    image = image.updateMask(snowAreaImg.mask());
    image = image.updateMask(number_unmasked_pixels)
    return image;
  });
  burns = burns.mosaic().select(["BurnDate"]);
  // Map.addLayer(burns, {palette: "red"}, "fire");
  burns = burns.addBands(ee.Image.pixelLonLat())
                       .toDouble();
  
  burns = burns.updateMask(burns.select('BurnDate').mask())
  
  // print(burns)                     
  Export.image.toAsset({
    image: burns,
    description: "Asset-burnImage8-"+burnName+'_burnOnce', 
    assetId: "burnSnow/burnImage8-"+burnName+'_burnOnce',
    region: roi,
    scale: 1000,
    crs: "EPSG:4326",
    maxPixels: 1e13
  });
}


function main3_2() {
  
  var burnName = '20051001to20061001WithLonLat'+'_burnOnce'
  var burnImg = ee.Image("users/yunxiaz1/burnSnow/"+"burnImage8-"+burnName);
  Export.image.toDrive({
    image: burnImg, 
    description: "Drive-"+burnName,
    folder: "BurnImage8_0715_2",
    fileNamePrefix: "BurnImage8_" + burnName,
    region: roi,
    scale: 1000,
    maxPixels: 1e13
  });
    
}

// Get areas where fire never occur
function main4() {
  
  var MosaicFire = burn.filterDate("2000-10-1", "2020-10-1").select("BurnDate");
  var burnedAreaVis = {
  min: 0.0,
  max: 10000000,
  palette: ['#000000'],
  };
  Map.setCenter(6.746, 46.529, 2);
  // Map.addLayer(MosaicFire.select(["BurnDate"]), burnedAreaVis, 'Burned Area');
  
  
  var startDate = ee.Date("2002-10-1");
  var endDate = ee.Date("2020-10-1");
  var burnName = '20021001to20201001WithLonLat'
  var snowName = 'SnowArea20001001to20191001_2';
  var snowAreaImg = ee.Image("users/yunxiaz1/burnSnow/"+snowName);
  var burns = getGoodBurn(startDate, endDate);
  burns = burns.map(function(image) {
    image = image.updateMask(snowAreaImg.mask());
    image = fireMask(image, MosaicFire)
    return image;
  });
  
  // Map.addLayer(burns.select(["constant"]), burnedAreaVis, 'Burned Area');
  burns = burns.mosaic().select(["constant"]);
  // Map.addLayer(burns, {palette: "red"}, "fire");
  burns = burns.addBands(ee.Image.pixelLonLat())
                       .toDouble();
  
  burns = burns.updateMask(burns.select('constant').mask())
  Map.addLayer(burns.select(["constant"]), burnedAreaVis, 'Burned Area');


  Export.image.toAsset({
    image: burns,
    description: "Asset-burnImage8-"+burnName+'_NeverBurn', 
    assetId: "burnSnow/burnImage8-"+burnName+'_NeverBurn',
    region: roi,
    scale: 1000,
    crs: "EPSG:4326",
    maxPixels: 1e13
  });
}


function main5() {
  
  var burnName = '20021001to20201001WithLonLat_NeverBurn';
  var burnImg = ee.Image("users/yunxiaz1/burnSnow/"+"burnImage8-"+burnName);
  Export.image.toDrive({
    image: burnImg, 
    description: "Drive-"+burnName,
    folder: "BurnImage8_0715",
    fileNamePrefix: "BurnImage8_" + burnName,
    region: roi,
    scale: 1000,
    maxPixels: 1e13
  });
    
}

// Get DEM 
function main6() {
  
  
  var DEMImg = DEM.select('be75');
  DEMImg = DEMImg.addBands(ee.Image.pixelLonLat())
                       .toDouble();
  Export.image.toDrive({
    image: DEMImg, 
    description: "Drive-"+"image_DEM2",
    folder: "DEM_0715",
    fileNamePrefix: "image_DEM2",
    region: roi,
    scale: 1000,
    maxPixels: 1e13
  });
    
}

// Get biome type and ecoregion ID
function main7() {
  var ecoRegions = ee.FeatureCollection("RESOLVE/ECOREGIONS/2017")
  var properties = ["BIOME_NUM", "ECO_ID"];
  var image_Biome = ecoRegions.reduceToImage({
                      properties: properties,
                      reducer: ee.Reducer.first().forEach(properties)
                    });
                    
  var image_ECO = image_Biome.select(["ECO_ID"])                  
                    
                    
  
  image_ECO = image_ECO.addBands(ee.Image.pixelLonLat())
                       .toDouble();
  Export.image.toDrive({
    image: image_ECO, 
    description: "Drive-"+"image_ECO",
    folder: "ECO_0715",
    fileNamePrefix: "image_ECO",
    region: roi,
    scale: 1000,
    maxPixels: 1e13
  });
    
}
//first step: calculate SP for each year
main1();
//second step: cacluate seasonal snow area
// main2();
// third step: calculate burn positions (burned only once between 2000-2020) in seasnal snow area
// main3();
// main3_2();
// fourth step:: calculate burn positions (burned many times between 2000-2020) in seasnal snow area
// main4();
// fifth step: export image to Drive from Asset
// main5();
// Sixth: elevation
// main6();
// Seventh: ecoID
// main7();




  



  
