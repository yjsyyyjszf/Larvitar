/*
 This file provides functionalities for
 custom Reslice Loader
*/

// external libraries
import cornerstone from "cornerstone-core";
import cornerstoneWADOImageLoader from "cornerstone-wado-image-loader";

// internal libraries
import { getImageFrame } from "./commonLoader";
import { dicomManager } from "./dicomLoader";
import { larvitar_store } from "../index";
let store = larvitar_store.state ? larvitar_store : new larvitar_store();

/*
 * This module provides the following functions to be exported:
 * loadReslicedImage(imageId)
 */

// ====================================
// Custom Loader for WadoImageLoader ==
// ================================
export const loadReslicedImage = function(imageId) {
  let seriesId = store.get("seriesId");
  let orientation = store.get("orientation");
  let instance = dicomManager[seriesId][orientation].instances[imageId];
  var reslicedPixeldata = instance.pixelData;
  return createCustomImage(imageId, instance.metadata, reslicedPixeldata);
};

/* Internal module functions */

// ===================================================================
// create the custom image object for cornerstone from custom image ==
// ===================================================================
let createCustomImage = function(imageId, metadata, pixelData, dataSet) {
  let canvas = window.document.createElement("canvas");
  let lastImageIdDrawn = "";

  let imageFrame = getImageFrame(metadata, dataSet);

  // This function uses the pixelData received as argument without manipulating
  // them: if the image is compressed, the decompress function should be called
  // before creating the custom image object (like the multiframe case).
  imageFrame.pixelData = pixelData;

  let pixelSpacing = metadata.x00280030;
  let rescaleIntercept = metadata.x00281052;
  let rescaleSlope = metadata.x00281053;
  let windowCenter = metadata.x00281050;
  let windowWidth = metadata.x00281051;

  function getSizeInBytes() {
    let bytesPerPixel = Math.round(imageFrame.bitsAllocated / 8);
    return (
      imageFrame.rows *
      imageFrame.columns *
      bytesPerPixel *
      imageFrame.samplesPerPixel
    );
  }

  let image = {
    imageId: imageId,
    color: cornerstoneWADOImageLoader.isColorImage(
      imageFrame.photometricInterpretation
    ),
    columnPixelSpacing: pixelSpacing ? pixelSpacing[1] : undefined,
    columns: imageFrame.columns,
    height: imageFrame.rows,
    intercept: rescaleIntercept ? rescaleIntercept : 0,
    invert: imageFrame.photometricInterpretation === "MONOCHROME1",
    minPixelValue: imageFrame.smallestPixelValue,
    maxPixelValue: imageFrame.largestPixelValue,
    render: undefined, // set below
    rowPixelSpacing: pixelSpacing ? pixelSpacing[0] : undefined,
    rows: imageFrame.rows,
    sizeInBytes: getSizeInBytes(),
    slope: rescaleSlope ? rescaleSlope : 1,
    width: imageFrame.columns,
    windowCenter: windowCenter ? windowCenter[0] : undefined,
    windowWidth: windowWidth ? windowWidth[0] : undefined,
    decodeTimeInMS: undefined,
    webWorkerTimeInMS: undefined
  };

  // add function to return pixel data
  image.getPixelData = function() {
    return imageFrame.pixelData;
  };

  // convert color space
  if (image.color) {
    // setup the canvas context
    canvas.height = imageFrame.rows;
    canvas.width = imageFrame.columns;

    let context = canvas.getContext("2d");
    let imageData = context.createImageData(
      imageFrame.columns,
      imageFrame.rows
    );
    cornerstoneWADOImageLoader.convertColorSpace(imageFrame, imageData);

    imageFrame.imageData = imageData;
    imageFrame.pixelData = imageData.data;
  }

  // Setup the renderer
  if (image.color) {
    image.render = cornerstone.renderColorImage;
    image.getCanvas = function() {
      if (lastImageIdDrawn === imageId) {
        return canvas;
      }

      canvas.height = image.rows;
      canvas.width = image.columns;
      let context = canvas.getContext("2d");
      context.putImageData(imageFrame.imageData, 0, 0);
      lastImageIdDrawn = imageId;
      return canvas;
    };
  } else {
    image.render = cornerstone.renderGrayscaleImage;
  }

  // calculate min/max if not supplied
  if (image.minPixelValue === undefined || image.maxPixelValue === undefined) {
    let minMax = cornerstoneWADOImageLoader.getMinMax(pixelData);
    image.minPixelValue = minMax.min;
    image.maxPixelValue = minMax.max;
  }

  // set the ww/wc to cover the dynamic range of the image if no values are supplied
  if (image.windowCenter === undefined || image.windowWidth === undefined) {
    if (image.color) {
      image.windowWidth = 255;
      image.windowCenter = 128;
    } else {
      let maxVoi = image.maxPixelValue * image.slope + image.intercept;
      let minVoi = image.minPixelValue * image.slope + image.intercept;
      image.windowWidth = maxVoi - minVoi;
      image.windowCenter = (maxVoi + minVoi) / 2;
    }
  }

  // Custom images does not have the "data" attribute becaouse their dataset is
  // not available. The "metadata" attribute is used by the storeImageData
  // function to store custom image pixelData and metadata.
  image.metadata = metadata;

  let promise = new Promise(function(resolve) {
    resolve(image);
  });

  // Return an object containing the Promise to cornerstone so it can setup callbacks to be
  // invoked asynchronously for the success/resolve and failure/reject scenarios.
  return {
    promise
  };
};
