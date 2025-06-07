document.addEventListener('DOMContentLoaded', function() {
  
  // Get references to DOM elements
  const makeRequestButton = document.getElementById('check-requests-btn');
  const requestUrlInput = document.getElementById('check-requests-url');
  const actionKey = 'checkrequests';

  const throttle = (func, delay, unthrottledCallback = null) => {
    let timeoutId;
    let lastExecTime = 0;
    if (delay <= 0) delay = 1;
    
    return function(...args) {
      const currentTime = Date.now();
      
      if (currentTime - lastExecTime > delay) {
        func.apply(this, args);
        lastExecTime = currentTime;
      } else {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          func.apply(this, args);
          lastExecTime = Date.now();
          if (typeof unthrottledCallback === 'function') unthrottledCallback();
        }, delay - (currentTime - lastExecTime));
      }
    };
  };

  const throttleDelay = 1500;
  const throttledClick = throttle(function() {
    // we throttle the click event so the user cant spam the button
    makeRequestButton.disabled = true;
    const _browser = typeof chrome === 'undefined' ? browser : chrome;
    _browser.runtime.sendMessage({
      action: actionKey,
      value: requestUrlInput.value,
    }, function(response) { /* ignore the response we get back */ });
  }, throttleDelay, () => { makeRequestButton.disabled = false; });

  // Send data to background script
  makeRequestButton.addEventListener('click', throttledClick);
});