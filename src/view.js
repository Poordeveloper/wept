import Bus from './bus'
import merge from 'merge'
import Emitter from 'emitter'
import {uid, createFrame, parsePath} from './util'
import {navigateBack} from './command'

function isMap(path) {
  return /^\/\/(www\.streetdirectory\.com|3gimg\.qq\.com)/.test(path)
}

export default class View extends Emitter {
  constructor(path) {
    if (!path) throw new Error('path required for view')
    super()
    let id = this.id = uid()
    let o = parsePath(path)
    this.url = path
    this.path = o.path
    this.query = o.query
    this.isMap = isMap(path)
    let external = this.external = /^\/\//.test(path)
    let root = document.querySelector('.scrollable')
    let width = window.innerWidth
    let ratio = window.devicePixelRatio
    const prefix = window.cordova ? '' : '/';
    let url = external ? path : `${prefix}app/${o.path}.wxml?w=${width}&r=${ratio}`
    if (window.fhashes && window.fhashes[o.path]) {
      url = `${prefix}app/${o.path}.html?v=` + window.fhashes[o.path];
    }
    this.el = createFrame(`view-${id}`, url, false, root)
    this.ready = false
    if (this.isMap) {
      this.el.contentWindow.addEventListener('load', () => {
        this._onReady()
      })
    } else {
      Bus.on('ready', viewId => {
        if (viewId == id) {
          this._onReady()
        }
      })
    }
    this.readyCallbacks = []
    setTimeout(() => this.observeTouch(), 1000);
  }
  onTouchStart = (e) => {
    if (!this.previous) return;
    if (e.touches[0].pageX > 60) return;
    this.startPoint = e.touches[0];
    this.startTime = new Date()
  }
  onTouchMove = (e) => {
    if (!this.previous) return;
    this.curPoint = e.touches[0];
    if (!this.startPoint && this.curPoint.pageX < 60) {
      this.startPoint = this.curPoint;
      this.startTime = new Date()
    }
    const s = this.startPoint;
    if (!s) return;
    const c = this.curPoint;
    const dx = c.screenX - s.screenX;
    this.dx = dx;
    const dy = c.screenY - s.screenY;
    if (dx > 0 && Math.abs(dy) < 30) {
      if (this.previous.el.style.display !== 'block') this.previous.el.style.display = 'block';
      this.el.style.marginLeft = dx + 'px';
    }
  }
  onTouchEnd = (e) => {
    if (this.dx > 0) {
      if (this.dx > document.body.clientWidth / 2 ||
        this.dx > 60 && (new Date() - this.startTime) < 500) {
        navigateBack();
      } else {
        this.previous.el.style.display = 'none';
        this.el.style.marginLeft = '0px';
      }
    }
    delete this.startPoint;
    delete this.dx;
  }
  observeTouch() {
    if (!this.previous) return;
    this.unobserveTouch();
    const innerDoc = this.el.contentDocument || this.el.contentWindow.document;
    innerDoc.body.addEventListener('touchstart', this.onTouchStart);
    innerDoc.body.addEventListener('touchmove', this.onTouchMove);
    innerDoc.body.addEventListener('touchend', this.onTouchEnd);
  }
  unobserveTouch() {
    const innerDoc = this.el.contentDocument || this.el.contentWindow.document;
    innerDoc.body.removeEventListener('touchstart', this.onTouchStart);
    innerDoc.body.removeEventListener('touchmove', this.onTouchMove);
    innerDoc.body.removeEventListener('touchend', this.onTouchEnd);
  }
  _onReady() {
    if (this._removed) return
    let cbs = this.readyCallbacks
    if (!cbs) {
      Bus.emit('reload', this)
      return
    }
    this.ready = true
    for (let cb of cbs) {
      cb()
    }
    this.readyCallbacks = null
    const e = document.getElementById('splash');
    if (e) e.parentNode.removeChild(e); // e.remove has bad compatibility
  }
  onReady(cb) {
    if (this.ready) return cb()
    this.readyCallbacks.push(cb)
  }
  setLocation(data) {
    this.location = {
      name: data.poiname,
      address: data.poiaddress,
      latitude: data.latlng.lat,
      longitude: data.latlng.lng
    }
    // TODO implement map location
    console.log(this.location)
  }
  hide() {
    this.el.style.display = 'none'
    const innerDoc = this.el.contentDocument || this.el.contentWindow && this.el.contentWindow.document;
    if (!innerDoc) return;
    const elems = innerDoc.getElementsByClassName('wx-scroll-view');
    for (let i = 0; i < elems.length; ++i) {
      elems[i].style.webkitOverflowScrolling = 'auto';
    }
    this.unobserveTouch();
  }
  show() {
    this.el.style.display = 'block'
    const innerDoc = this.el.contentDocument || this.el.contentWindow && this.el.contentWindow.document;
    if (!innerDoc) return;
    const elems = innerDoc.getElementsByClassName('wx-scroll-view');
    for (let i = 0; i < elems.length; ++i) {
      elems[i].style.webkitOverflowScrolling = null;
    }
    this.observeTouch();
  }
  destroy() {
    this.unobserveTouch();
    this._removed = true
    this.emit('destroy')
    this.off()
    this.el.parentNode.removeChild(this.el)
  }
  postMessage(data) {
    this.onReady(() => {
      let obj = merge.recursive(true, {
        to: 'webframe',
        webviewID: this.id,
        id: Math.random()
      }, data)
      obj.msg = data.msg || {}
      this.el.contentWindow.postMessage(obj, '*')
    })
  }
  reloadWxss(path) {
    let width = window.innerWidth
    let ratio = window.devicePixelRatio
    if (this.el.contentWindow.hasOwnProperty('reloadWxss')) {
      this.el.contentWindow.reloadWxss(width, ratio, path)
    }
  }
  resizeWxss() {
    let width = window.innerWidth
    let ratio = window.devicePixelRatio
    if (this.el.contentWindow.hasOwnProperty('resizeWxss')) {
      this.el.contentWindow.resizeWxss(width, ratio)
    }
  }
  reloadWxml() {
    // load generateFn and notify view
    this.el.contentWindow.location.reload()
  }
}
