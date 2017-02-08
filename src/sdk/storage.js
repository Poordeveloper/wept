import Emitter from 'emitter'

// 5MB
const LIMIT_SIZE = 5*1024

function currentSize() {
  var total = 0
  for(var x in localStorage) {
    var amount = (localStorage[x].length * 2) / 1024
    total += amount
  }
  return Math.ceil(total)
}

let storage = {
  set: function (key, value) {
    if (window.localStorage == null) return console.error('localStorage not supported')
    try {
    localStorage.setItem(key, value);
    } catch (err) {}
    this.emit('change')
  },
  get: function (key) {
    if (window.localStorage == null) return console.error('localStorage not supported')
    let str = localStorage.getItem(key)
    try {
      str = JSON.parse(str)
    } catch(err) {}
    return {
      data: str,
    }
  },
  remove: function (key) {
    if (window.localStorage == null) return console.error('localStorage not supported')
    const data = this.get(key);
    try {
    localStorage.removeItem(key);
    } catch (err) {}
    this.emit('change')
    return data;
  },
  clear: function () {
    if (window.localStorage == null) return console.error('localStorage not supported')
    localStorage.clear();
    this.emit('change')
  },
  getAll: function () {
    if (window.localStorage == null) return console.error('localStorage not supported')
    const res = {};
    Object.keys(localStorage).forEach((key) => {
      res[key] = this.get(key)
    })
    return res
  },
  info: function () {
    if (window.localStorage == null) return console.error('localStorage not supported')
    return {
      keys: Object.keys(localStorage),
      limitSize: LIMIT_SIZE,
      currentSize: currentSize()
    }
  }
}


Emitter(storage)

export default storage
