/*global __wxConfig__*/
import { hidePreview } from './component/preview'
import Nprogress from 'nprogress'
import filePicker from 'file-picker'
import merge from 'merge'
import Upload from 'upload'
import Serial from 'node-serial'
import Bus from './bus'
import * as viewManage from './viewManage'
import {onNavigate, onLaunch, onBack} from './service'
import header from './header'
import throttle from 'throttleit'
import {toAppService} from './service'
// import record from './sdk/record'
import Compass from './sdk/compass'
import storage from './sdk/storage'
import Picker from './sdk/picker'
import TimePicker from './sdk/timePicker'
import DatePicker from './sdk/datePicker'
import * as fileList from './sdk/fileList'
import toast from './sdk/toast'
import image from './sdk/image'
import modal from './sdk/modal'
import actionSheet from './sdk/actionsheet'
import {once} from './event'
import Preview from './component/preview'
import confirm from './component/confirm'
import Toast from './component/toast'
import mask from './component/mask'
import qrscan from './component/qrscan'
import {getRedirectData, validPath, dataURItoBlob, toNumber} from './util'
import fixOrientation from 'fix-orientation'

let appData = {} //eslint-disable-line
let fileIndex = 0
let fileStore = {}

Bus.on('reload', view => {
  let p = view.path
  let data = appData[p]
  if (!data) throw new Error('AppData not found for ' + p)
  let win = __wxConfig__.window
  let winConfig = win.pages[p] || {}
  let ptr = winConfig.enablePullDownRefresh || false
  view.postMessage({
    act: "sendMsgFromAppService",
    id: Math.random(),
    msg: {
      eventName: "appDataChange",
      data: {
        data:{
          data: data,
          ext: {
            webviewId: view.id,
            enablePullDownRefresh: ptr
          },
          options: {
            firstRender: true
          }
        }
      },
      sdkName: "publish",
      to: "backgroundjs",
      comefrom: "webframe",
      command: "COMMAND_FROM_ASJS"
    },
    command: "MSG_FROM_APPSERVICE",
  })
  console.info('Reloaded ' + view.url)
})

export function getPublicLibVersion() {
  //ignore
}

export function systemLog() {
  //ignore
}

export function showShareMenu() {}

export function switchTab(data) {
  let url = data.args.url
  Nprogress.start()
  viewManage.switchTo(url)
  onNavigate(data, 'switchTab')
}

export function shareAppMessage(data) {
  let {desc, imgUrl, path, title} = data.args
  modal({
    title,
    imgUrl,
    content: desc
  }).then(confirm => {
    onSuccess(data, { confirm })
  })
}

export function requestPayment(data) {
  confirm('确认支付吗？').then(() => {
    onSuccess(data, {statusCode: 200})
  }, () => {
    onError(data)
  })
}

function convertImageUrl(img) {
  if (!img) return;
  if (img.startsWith('http') && img.indexOf('?') < 0) {
    return img + '?imageMogr2/auto-orient/format/jpg';
  }
}

export function previewImage(data) {
  let args = data.args
  if (wx.isReady && args.current.startsWith('http')) {
    wx.previewImage(args);
    onSuccess(data);
    return;
  }
  let current = convertImageUrl(args.current)
  const ismobile=navigator.userAgent.match(/(iPad)|(iPhone)|(iPod)|(android)|(webOS)/i)
  let urls = ismobile ? args.urls.map(convertImageUrl) : [current]
  let preview = new Preview(urls, {})
  preview.show()
  preview.active(current)
  onSuccess(data)
}

export function PULLDOWN_REFRESH(data) {
  toAppService({
    msg: {
      data: {},
      eventName: "onPullDownRefresh",
      webviewID: data.webviewID
    }
  })
}

export function stopPullDownRefresh(data) {
  let curr = viewManage.currentView()
  if (curr) {
    curr.postMessage({
      command: "STOP_PULL_DOWN_REFRESH"
    })
  }
  data.sdkName = 'stopPullDownRefresh'
  onSuccess(data)
}

// publish event to views
export function publish(data) {
  let all_ids = viewManage.getViewIds()
  let ids = toNumber(data.webviewIds) || all_ids
  data.act = 'sendMsgFromAppService'
  let obj = {
    msg: data,
    command: 'MSG_FROM_APPSERVICE'
  }
  viewManage.eachView(view => {
    if (ids.indexOf(view.id) !== -1) {
      view.postMessage(obj)
    }
  })
}

export function scanCode(data) {
  qrscan().then(val => {
    onSuccess(data, {
      result: val
    })
  }, () => {
    onCancel(data)
  })
}

export function WEBVIEW_READY (data) {
  //console.log(data)
}

export function redirectTo(data) {
  Nprogress.start()
  viewManage.redirectTo(data.args.url)
  onNavigate(data, 'redirectTo')
}

export function navigateTo(data) {
  if (data.args.url.startsWith('http')) {
    window.location.href = data.args.url;
    return;
  }
  if (window.location.href.search('/_retained\//') < 0) {
    window.history.pushState(null, '', data.args.url);
    data.pushState = true;
    redirectTo(data);
    return;
  }
  let str = sessionStorage.getItem('routes')
  if (str && str.split('|').length == 5) {
    console.warn('WEPT: 当前页面栈已到达 5 个，请注意控制 navigateTo 深度')
  }
  Nprogress.start()
  viewManage.navigateTo(data.args.url)
  onNavigate(data, 'navigateTo')
}

window.onpopstate = function() {
  hidePreview();
  if (window.location.href.search('/_retained\//') >= 0) {
    viewManage.navigateBack(1, () => {
      onBack();
    })
    return;
  }
  let path = window.location.href.split('#!')[1];
  if (!path) path = 'page/index/index';
  redirectTo({onpopstate: true, args:{url:path.replace('page/', 'pages/')}});
}

export function navigateBack(data) {
  return window.history.back();
  data.args = data.args || {}
  data.args.url = viewManage.currentView().path + '.html'
  let delta = data.args.delta ? Number(data.args.delta) : 1
  if (isNaN(delta)) return Toast('Delta 必须为数字', {type: 'error'})
  viewManage.navigateBack(delta, () => {
    onBack()
  })
  onNavigate(data, 'navigateBack')
}

function getRoutes() {
  let root = window.__root__
  let path = location.hash.replace(/^#!/, '')
  if (sessionStorage == null) return path ? [path] : [root]
  let str = sessionStorage.getItem('routes')
  if (!str) return path ? [path] : [root]
  let routes = str.split('|')
  if (routes.indexOf(path) !== routes.length - 1) {
    return path ? [path] : [root]
  }
  return routes
}

export function APP_SERVICE_COMPLETE(data) { //eslint-disable-line
  Bus.emit('APP_SERVICE_COMPLETE')
  let routes = getRoutes()
  let first = routes.shift()
  let valid = validPath(first)
  if (!valid) console.warn(`Invalid route: ${first}, redirect to root`)
  // make sure root is valid page
  let root =  valid ? first : window.__root__
  viewManage.navigateTo(root)
  onLaunch(root)
  if (!valid) return
  if (routes.length) {
    mask.show()
    let cid = viewManage.currentView().id
    Bus.once('ready', id => {
      if (id !== cid) return mask.hide()
      let serial = new Serial()
      serial.timeout(10000)
      for (let route of routes) {
        // check if in pages
        valid = validPath(route)
        if (!valid) {
          console.warn(`无法在 pages 配置中找到 ${route}，停止路由`)
          break;
        }
        serial.add(cb => {
          let data = getRedirectData(`/${route}`, viewManage.currentView().id)
          toAppService(data)
          Bus.once('ready', () => cb())
        })
      }
      serial.done(err => {
        mask.hide()
        if (err) {
          console.error(err.stack)
          Toast(err.message, {type: 'error'})
          return
        }
      })
    })
  }
}

export function GET_APP_DATA(data) {
  window.postMessage({
    to: data.comefrom,
    comefrom: 'backgroundjs',
    msg: {
      appData: appData
    },
    command: 'SEND_APP_DATA',
  }, '*')
}

export function WRITE_APP_DATA(data) {
  appData = data.data
  toAppService({
    command: 'WRITE_APP_DATA',
    msg: appData
  })
}

export function GET_APP_STORAGE(data) {
  let res = storage.getAll()
  window.postMessage({
    to: data.comefrom,
    msg: {
      storage: res
    },
    command: 'SET_APP_STORAGE'
  }, '*')
}

export function DELETE_APP_STORAGE(data) {
  if (!data.data || !data.data.key) return console.error('key not found')
  storage.remove(data.data.key)
}

export function SET_APP_STORAGE(data) {
  let d = data.data
  if (!d || !d.key || !d.type)  return console.error('wrong arguments')
  storage.set(d.key, d.value, d.type)
}

storage.on('change', () => {
  let res = storage.getAll()
  window.postMessage({
    to: 'devtools-storage',
    msg: {
      storage: res
    },
    command: 'SET_APP_STORAGE'
  }, '*')
})

export function send_app_data(data) {
  appData = data.appData
  window.postMessage({
    to: 'devtools-appdata',
    msg: {
      appData: appData
    },
    command: 'SEND_APP_DATA'
  }, '*')
}

export function setNavigationBarTitle(data) {
  let title = data.args.title
  if (title) header.setTitle(title)
}

export function showNavigationBarLoading() {
  header.showLoading()
}

export function hideNavigationBarLoading() {
  header.hideLoading()
}

export function chooseImage(data) {
   /*
  // for image rotation issue, we prefer to use wx.chooseImage, but no way to draw in canvas to upload
  if (typeof wx !== 'undefined' && wx.isReady && navigator.userAgent.indexOf('wechatdevtools') < 0) {
    wx.chooseImage({
      count: data.args.count || 1,
      sizeType: data.args.sizeType,
      sourceType: data.args.sourceType,
      success: (res) => {
        onSuccess(data, { tempFilePaths: res.localIds });
      }, 
    });
    return;
  }
  */
  let URL = (window.URL || window.webkitURL)
  filePicker({ multiple: true, accept: 'image/*' }, files => {
    const count = data.args.count || 1;
    files = [].slice.call(files, [0, count])
    /*
    let paths = files.map(file => {
      let blob = URL.createObjectURL(file)
      fileStore[blob] = file
      return blob
    })
    onSuccess(data, { tempFilePaths: paths })
    */
    var paths = []
    files.forEach((file) => {
      var reader = new FileReader();
      reader.onload = function (ev) {
        var url = ev.target.result;
        fixOrientation(url, function(fixed) {
          if (fixed === url) {
            paths.push(URL.createObjectURL(file));
          } else {
            paths.push(dataURItoBlob(fixed));
          }
          if (paths.length === files.length) onSuccess(data, { tempFilePaths: paths });
        });
      }
      reader.readAsDataURL(file);
    });
    if (!files.length) onSuccess(data, { tempFilePaths: [] });
  })
}

export function chooseVideo(data) {
  let URL = (window.URL || window.webkitURL)
  filePicker({accept: 'video/*' }, files => {
    let path = URL.createObjectURL(files[0])
    fileStore[path] = files[0]
    let video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = function () {
      let duration = video.duration
      let size = files[0].size
      onSuccess(data, {
        duration,
        size,
        height: video.videoHeight,
        width: video.videoWidth,
        tempFilePath: path
      })
    }
    video.src =  path
  })
}

export function saveFile(data) {
  let blob = data.args.tempFilePath
  if (!blob) return onError(data, 'file path required')
  let file = fileStore[blob]
  if (!file) return onError(data, 'file not found')
  let upload = new Upload(file)
  upload.to('/upload')
  upload.on('end', xhr => {
    if (xhr.status / 100 | 0 == 2) {
      let result = JSON.parse(xhr.responseText)
      onSuccess(data, {
        statusCode: xhr.status,
        savedFilePath: result.file_path
      })
    } else {
      onError(data, `request error ${xhr.status}`)
    }
  })
  upload.on('error', err => {
    onError(data, err.message)
  })
}

export function enableCompass() {
  let id = Compass.watch(throttle(head => {
    toAppService({
      msg: {
        eventName: 'onCompassChange',
        type: 'ON_APPLIFECYCLE_EVENT',
        data: {
          direction: head
        }
      }
    })
  }, 200))
  viewManage.currentView().on('destroy', () => {
    Compass.unwatch(id)
  })
}

export function enableAccelerometer() {
  if(window.DeviceMotionEvent){
    let handler = throttle(event => {
      let {x, y, z} = {
        x: event.accelerationIncludingGravity.x,
        y: event.accelerationIncludingGravity.y,
        z: event.accelerationIncludingGravity.z
      }
      if (x == null || y == null || z == null) return
      toAppService({
        msg: {
          eventName: 'onAccelerometerChange',
          type: 'ON_APPLIFECYCLE_EVENT',
          data: {x, y, z}
        }
      })
    }, 200)
    window.addEventListener("devicemotion", handler, false);
    viewManage.currentView().on('destroy', () => {
      window.removeEventListener("devicemotion", handler, false);
    })
  } else {
    console.warn("DeviceMotionEvent is not supported");
  }
}

export function getNetworkType(data) {
  let type = navigator.connection == null ? 'WIFI' : navigator.connection.type
  onSuccess(data, {
    networkType: type
  })
}

export function login(data) {
  if (window.location.href.search('localhost') >= 0) return;
  window.location = (data.args.url || (window.location.origin + '/api/wx/auth/snsapi_userinfo?state=')) + encodeURIComponent(window.location.href)
}

export function pushState(data) {
  if (typeof history.pushState == 'function') {
    let url = window.location.origin + '#!' + data.args.page + '?';
    delete data.args.page;
    for (let key in data.args) {
      if (data.args.hasOwnProperty(key)) {
        url += key + '=' + data.args[key] + '&';
      }
    }
    history.pushState({}, '', url)
  }
}

export function replaceState(data) {
  if (typeof history.replaceState == 'function') {
    let url;
    if (data.args.page) {
      url = window.location.origin + '#!' + data.args.page + '?';
      delete data.args.page;
    } else url = window.location.href.split('?')[0] + '?';
    for (let key in data.args) {
      if (data.args.hasOwnProperty(key)) {
        url += key + '=' + data.args[key] + '&';
      }
    }
    history.replaceState({}, '', url)
  }
}

export function getLocation(data, noNative) {
  if (!noNative && typeof wx !== 'undefined' && wx.isReady && navigator.userAgent.indexOf('wechatdevtools') < 0) {
    wx.getLocation({
      success: (res) => {
        onSuccess(data, res);
      },
      fail: (err) => {
        getLocation(data, true);
      },
    });
  } else if ("geolocation" in navigator) {
     const options = {
      enableHighAccuracy: false,
      timeout: 3000,
      maximumAge: 0
     };
    const timeout = setTimeout(() => { onError(data, 'timeout'); }, 3100);
    navigator.geolocation.getCurrentPosition(position => {
      clearTimeout(timeout);
      let coords = position.coords
      onSuccess(data, {
        longitude: coords.longitude,
        latitude: coords.latitude
      })
    }, error => {
      clearTimeout(timeout);
      onError(data, error);
    }, options)
  } else {
    onError(data, {
      message: 'geolocation not supported'
    })
  }
}

export function openLocation(data) {
  let args = data.args
  if (typeof wx !== 'undefined' && wx.launchFromIndex && wx.isReady && navigator.userAgent.indexOf('wechatdevtools') < 0) {
    wx.openLocation({
      latitude: args.latitude,
      longitude: args.longitude,
      address: args.address,
      name: args.name,
      scale: args.scale || 16,
    });
    Nprogress.done();
    onSuccess(data, {
      latitude: args.latitude,
      longitude: args.longitude
    });
    return;
  }
  let url = '/pages/map/map?lng=' + args.longitude + '&lat=' + args.latitude;
  if (args.address) url += '&showAddress=' + args.address.replace(/&/g, ' ');
  navigateTo({ args: { url } });
  /*
  let url = "//apis.map.qq.com/tools/poimarker?type=0&marker=coord:" + args.latitude + "," + args.longitude + "&key=JMRBZ-R4HCD-X674O-PXLN4-B7CLH-42BSB&referer=wxdevtools"
  viewManage.openExternal(url)
  Nprogress.done()
  onSuccess(data, {
    latitude: args.latitude,
    longitude: args.longitude
  })
  */
}

export function chooseLocation(data) {
  let url = `//3gimg.qq.com/lightmap/components/locationPicker2/index.html?search=1&type=1&coord=39.90403%2C116.407526&key=JMRBZ-R4HCD-X674O-PXLN4-B7CLH-42BSB&referer=wxdevtools`
  viewManage.openExternal(url)
  Nprogress.done()
  let called = false
  Bus.once('back',() => {
    if (!called) {
      called = true
      onCancel(data)
    }
  })
  Bus.once('location', location => {
    if (!called) {
      called = true
      if (location) {
        onSuccess(data, location)
      } else {
        onCancel(data)
      }
    }
  })
}

export function setStorage(data) {
  let args = data.args
  storage.set(args.key, args.data, args.dataType)
  if (args.key == null || args.key == '') {
    return onError(data, 'key required')
  }
  onSuccess(data)
}

export function getStorage(data) {
  let args = data.args
  if (args.key == null || args.key == '') {
    return onError(data, 'key required')
  }
  let res = storage.get(args.key)
  onSuccess(data, {
    data: res.data,
    dataType: res.dataType
  })
}

export function clearStorage(data) {
  storage.clear()
  onSuccess(data)
}


/*
export function startRecord(data) {
  record.startRecord({
    success: url => {
      onSuccess(data, {
        tempFilePath: url
      })
    },
    fail: err => {
      return onError(data, err.message)
    }
  }).catch((e) => {
    console.warn(`Audio record failed: ${e.message}`)
  })
}

export function stopRecord() {
  record.stopRecord().then(blob => {
    let filename = `audio${fileIndex}`
    fileIndex++
    let file = new File([blob], filename, {type: 'audio/x-wav', lastModified: Date.now()});
    fileStore[blob] = file
  })
}

export function playVoice(data) {
  let url = data.args.filePath
  let audio = document.getElementById("audio");
  if (audio.src && audio.paused && !audio.ended) {
    // resume
    audio.play()
  } else {
    audio.src = url
    audio.load()
    audio.play()
    once(audio, 'error', e => {
      onError(data, e.message)
    })
    once(audio, 'ended', () => {
      onSuccess(data)
    })
  }
}

export function pauseVoice() {
  let audio = document.getElementById("audio");
  audio.pause()
}

export function stopVoice() {
  let audio = document.getElementById("audio");
  audio.pause()
  audio.currentTime = 0
  audio.src = ''
}

window.addEventListener('DOMContentLoaded', function () {
  let audio = document.getElementById("background-audio");
  audio.addEventListener('error', function () {
    toAppService({
      msg: {
        eventName: 'onMusicError',
        type: 'ON_MUSIC_EVENT'
      }
    })
  }, false)
}, false)

export function getMusicPlayerState(data) {
  let a = document.getElementById("background-audio");
  let obj = {
    status: a.src ? a.paused ? 0 : 1 : 2,
    currentPosition: Math.floor(a.currentTime) || -1
  }
  if (a.src && !a.paused) {
    obj.duration = a.duration || 0
    try {
      obj.downloadPercent = Math.round(100*a.buffered.end(0)/a.duration)
    } catch(e) {
    }
    obj.dataUrl = a.currentSrc
  }
  onSuccess(data, obj)
}

export function operateMusicPlayer(data) {
  let args = data.args
  let a = document.getElementById("background-audio");
  switch (args.operationType) {
    case 'play':
      if (a.src == args.dataUrl && a.paused && !a.ended) {
        a.play()
      } else {
        a.src = args.dataUrl
        a.load()
        a.loop = true
        a.play()
      }
      toAppService({
        msg: {
          eventName: 'onMusicPlay',
          type: 'ON_MUSIC_EVENT'
        }
      })
      break
    case 'pause':
      a.pause()
      toAppService({
        msg: {
          eventName: 'onMusicPause',
          type: 'ON_MUSIC_EVENT'
        }
      })
      break
    case 'seek':
      a.currentTime = args.position
      break
    case 'stop':
      a.pause()
      a.currentTime = 0
      a.src = ''
      toAppService({
        msg: {
          eventName: 'onMusicEnd',
          type: 'ON_MUSIC_EVENT'
        }
      })
      break
  }
  onSuccess(data)
}
*/

function getBlobFromObjectUrl(url) {
  return new Promise((resolve, reject) => {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.onload = function(e) {
      if (xhr.status == 200) {
        var myBlob = xhr.response;
        resolve(myBlob);
      }
    };
    xhr.onerror = function (e) {
      reject(e);
    }
    xhr.send();
	});
}

export function uploadFile(data) {
  let args = data.args
  if (!args.filePath || !args.url || !args.name) {
    return onError(data, 'filePath, url and name required')
  }
  let file = fileStore[args.filePath]

  let headers = args.header || {}
  if (headers.Referer || headers.rederer) {
    console.warn('请注意，微信官方不允许设置请求 Referer')
  }
  let formData = args.formData || {}
  let xhr = new XMLHttpRequest()
  xhr.open('POST', args.url)
  xhr.onload = function () {
    if (xhr.status / 100 | 0 == 2) {
      onSuccess(data, {statusCode: xhr.status, data: xhr.responseText})
    } else {
      onError(data, `request error ${xhr.status}`)
    }
  }
  xhr.onerror = function (e) {
    onError(data, `request error ${e.message}`)
  }
  let key
  for (key in headers) {
    xhr.setRequestHeader(key, headers[key]);
  }
  let body = new FormData
  for (key in formData) {
    body.append(key, formData[key])
  }
  if (file) {
    body.append(args.name, file)
    xhr.send(body)
  } else {
    getBlobFromObjectUrl(args.filePath).then((blob) => {
      body.append(args.name, blob);
      xhr.send(body);
    }, error => onError(data, error));
  }
}

export function downloadFile(data) {
  let URL = (window.URL || window.webkitURL)
  let args = data.args
  if (!args.url) return onError(data, 'url required')
  let xhr = new XMLHttpRequest()
  xhr.responseType = 'arraybuffer'
  let headers = args.header || {}
  xhr.open('GET', '/remoteProxy?url=' + encodeURIComponent(args.url), true)
  xhr.onload = function () {
    if (xhr.status / 100 | 0 == 2 || xhr.status == 304) {
      let b = new Blob([xhr.response], {type: xhr.getResponseHeader("Content-Type")});
      let blob = URL.createObjectURL(b)
      fileStore[blob] = b
      onSuccess(data, {
        statusCode: xhr.status,
        tempFilePath: blob
      })
    } else {
      onError(data, `request error ${xhr.status}`)
    }
  }
  xhr.onerror = function (e) {
    onError(data, `request error ${e.message}`)
  }
  let key
  for (key in headers) {
    xhr.setRequestHeader(key, headers[key]);
  }
  xhr.send(null)
}

export function getSavedFileList(data) {
  fileList.getFileList().then(list => {
    onSuccess(data, {
      fileList: list
    })
  }, err => {
    onError(data, err.message)
  })
}

export function removeSavedFile(data) {
  let args = data.args
  if (requiredArgs(['filePath'], data)) return
  fileList.removeFile(args.filePath).then(() => {
    onSuccess(data, {})
  }, err => {
    onError(data, err.message)
  })
}

export function getSavedFileInfo(data) {
  let args = data.args
  if (requiredArgs(['filePath'], data)) return
  fileList.getFileInfo(args.filePath).then(info => {
    onSuccess(data, info)
  }, err => {
    onError(data, err.message)
  })
}

export function openDocument(data) {
  let args = data.args
  if (requiredArgs(['filePath'], data)) return
  console.warn('WEPT 中没有判定文件格式，返回为模拟返回')
  onSuccess(data)
  confirm(`<div>openDocument</div> ${args.filePath}`, true).then(() => {
  }, () => {
  })
}

export function getStorageInfo(data) {
  let info = storage.info()
  onSuccess(data, info)
}

export function removeStorage(data) {
  let args = data.args
  if (requiredArgs(['key'], data)) return

  let o = storage.remove(args.key)
  onSuccess(data, {data: o})
}

export function showToast(data) {
  if (requiredArgs(['title'], data)) return
  toast.show(data.args)
  onSuccess(data)
}

export function hideToast(data) {
  toast.hide()
  onSuccess(data)
}

export function showModal(data) {
  if (requiredArgs(['title'], data)) return
  modal(data.args).then(confirm => {
    onSuccess(data, { confirm })
  })
}

export function showActionSheet(data) {
  let args = data.args
  if (requiredArgs(['itemList'], data)) return
  if (!Array.isArray(args.itemList)) return onError(data, 'itemList must be Array')
  args.itemList = args.itemList.slice(0, 6)
  actionSheet(args).then(res => {
    onSuccess(data, res)
  })
}

export function getImageInfo(data) {
  if (requiredArgs(['src'], data)) return
  let src = data.args.src;
  const i = src.indexOf('blob');
  if (i > 0) src = src.slice(i);
  image(src).then(res => {
    onSuccess(data, res)
  }, err => {
    onError(data, err.message)
  })
}

export function base64ToTempFilePath(data) {
  let uri = data.args.base64Data
  // args.canvasId
  onSuccess(data, {
    filePath: dataURItoBlob(uri)
  })
}

export function refreshSession(data) {
  onSuccess(data)
}

export function showPickerView(data, args) {
  const picker = new Picker(args)
  picker.show()
  //picker.on('cancel', () => {})
  picker.on('select', n => {
    publishPagEevent('bindPickerChange', {
      type: 'change',
      currentTarget: {
        dataset: args.dataset,
      },
      detail: {
        value: n + ''
      }
    })
  })
}

export function showDatePickerView(data, args) {
  let picker
  let eventName
  if (args.mode == 'time') {
    eventName = 'bindTimeChange'
    picker = new TimePicker(args)
  } else {
    eventName = 'bindDateChange'
    picker = new DatePicker(args)
  }
  picker.show()
  picker.on('select', val => {
    publishPagEevent(eventName, {
      type: 'change',
      detail: {
        value: val
      },
      currentTarget: {
        dataset: args.dataset,
      },
    })
  })
}

function requiredArgs(keys, data) {
  let args = data.args
  for (var i = 0, l = keys.length; i < l; i++) {
    if (!args.hasOwnProperty(keys[i])) {
      onError(data, `key ${keys[i]} required for ${data.sdkName}`)
      return true
    }
  }
  return false
}

function onError(data, message) {
  let obj = {
    command: "GET_ASSDK_RES",
    ext: merge.recursive(true, {}, data),
    msg: {
      errMsg: `${data.sdkName}:fail`
    }
  }
  if (message) obj.msg.message = message
  toAppService(obj)
}

function onSuccess(data, extra = {}) {
  if (!data.sdkName) throw new Error('sdkName not found')
  let obj = {
    command: "GET_ASSDK_RES",
    ext: merge.recursive(true, {}, data),
    msg: {
      errMsg: `${data.sdkName}:ok`
    }
  }
  obj.msg = merge.recursive(true, obj.msg, extra)
  toAppService(obj)
}

function onCancel(data, extra = {}) {
  let obj = {
    command: "GET_ASSDK_RES",
    ext: merge.recursive(true, {}, data),
    msg: {
      errMsg: `${data.sdkName}:cancel`
    }
  }
  obj.msg = merge.recursive(true, obj.msg, extra)
  toAppService(obj)
}

function publishPagEevent(eventName, extra) {
  let obj = {
    command: 'MSG_FROM_WEBVIEW',
    msg: {
      data: {
        data: {
          data: extra,
          eventName
        }
      },
      eventName: 'publish_PAGE_EVENT',
    }
  }
  toAppService(obj)
}

