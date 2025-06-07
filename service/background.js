// Preload rules, as the Chrome extension API doesn't support blocking operations.
let cachedRules = [];
let extraInfoSpec = ["blocking", "requestHeaders"];
const _FORCE_EXTRA_HEADERS = true; // if true, 'extraHeaders' will always be added to the extraInfoSpec, regardless of the rules the user have set up

const isChrome = typeof browser === 'undefined' && typeof chrome !== 'undefined';
const _browser = !isChrome ? browser : chrome;

function addExtraHeadersSpecificationIfNeeded(invalidateCache = false, extraHeaderShouldBeAdded = false) {
	const _addExtraHeader = () => {
		const keyExtraHeaders = "extraHeaders";
		if (!extraInfoSpec.includes(keyExtraHeaders)) {
			extraInfoSpec.push(keyExtraHeaders);
		}
	};

	if (!isChrome) return false;

	if (invalidateCache) extraInfoSpec = ["blocking", "requestHeaders"];

	// adding 'extraHeaders' has performance implications, so preferably we should only add it if we have rules that require it
	// this method is called from inside asyncUpdateCachedRules where the rules are checked for the need of 'extraHeaders'
	if (_FORCE_EXTRA_HEADERS) {
		_addExtraHeader();
	}
	else {
		if (extraHeaderShouldBeAdded) _addExtraHeader();
	}
}

async function asyncUpdateCachedRules() {
	return new Promise((resolve, reject) => {
		_browser.storage.local.get(['rules'], function(result) {
			if (result.rules) {
				cachedRules = result.rules;

				const extraHeadersTriggerKeys = [
					(headerToCheck) => ["authorization","cache-control","connection","content-length","host","origin","referer","te","upgrade", "via"].includes(headerToCheck),
					(headerToCheck) => ["if-", "proxy-","sec-"].some(prefix => headerToCheck.startsWith(prefix)),
				];
				let isExtraHeadersNeeded = false;

				for (let i = 0; i < cachedRules.length; i++) {
					// lowercase all header names and strip duplicate headers if any
					let fixedHeaders = cachedRules[i].headers.map(header => { return { name: header.name.toLowerCase(), value: header.value } }); 

					// remove duplicate headers, use the last one if there are duplicates
					for (let j = 0; j < fixedHeaders.length; j++) {
						const header = fixedHeaders[j];
						const headername = header.name.toLowerCase();

						const headerRequiresExtraHeaders = isExtraHeadersNeeded || extraHeadersTriggerKeys.some(trigger => trigger(headername));
						if (headerRequiresExtraHeaders) isExtraHeadersNeeded = true;

						const duplicateHeaders = cachedRules[i].headers.filter(h => h.name.toLowerCase() === headername);
						if (duplicateHeaders.length > 1) {
							fixedHeaders.splice(j, 1);
							fixedHeaders[j] = duplicateHeaders.pop();
						}
					}
					cachedRules[i].headers = fixedHeaders;

					// prepare the domains to be RegExp objects so we dont have to do it in our listener
					cachedRules[i].domains = cachedRules[i].domains.map(domain => {
						return typeof domain === 'string' ? new RegExp(domain) : domain;
					});

					// TODO: group up rules by domains if possible, so we can have less rules to check in our listener
					// this is easier done inside the listener as we have access to the request URL and can match it against the domains
					// but it would be better to do it here so we reduce the amount of work we do in the listener
				}

				// Add 'extraHeaders' specification if needed
				if (isExtraHeadersNeeded) addExtraHeadersSpecificationIfNeeded(true, true /* extraHeaderShouldBeAdded */);

				// NOTE: if the caching of domain rules are enabled, invalidate the current cache since our rules might have changed
				// forcing the extension to rebuild the cache with the new rules
				if (_ENABLE_DOMAIN_RULES_CACHE) cachedDomainRulesPair.clear();
			}
			else {
				debugger;
				cachedRules = [];
			}
			return resolve(cachedRules);
		});
	});
}

function initListeners() {
	if (_browser.webRequest.onBeforeSendHeaders.hasListener(onBeforeSendHeaders)) {
		_browser.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
	}
	
	// Async version
	asyncUpdateCachedRules().then(rules => {
		// TODO: either skip installing listener completely or strip 'blocking' from extraInfoSpec and add the listener anyways if we dont have any rules
		// if (!rules || rules.length === 0) {
		// 	extraInfoSpec = extraInfoSpec.filter(spec => spec !== "blocking");
		// 	_browser.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, { urls: ["<all_urls>"] }, extraInfoSpec);
		// 	return;
		// }

		// TODO: instead of using the current filter
		// we should use the filter from the rules themselves, ie from the domains array for each rule
		const FORCE_ALL_URLS = true;
		const domainMatches = FORCE_ALL_URLS ? ["<all_urls>"] : [...cachedRules.map(rule => rule.domains).flat().map(domain => domain.source)];
		_browser.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, { urls: domainMatches }, extraInfoSpec);
	});
}

function requestHeaderInspector(headers) {
	// user requested a http header check from our popup
	const formattedHeadersString = headers.map(header => `${header.name}: ${header.value}`).join('\n');

	// TODO: omit sensitive headers like Authorization, Cookie, etc.

	// TODO: find a better way to display the headers
	console.log(formattedHeadersString);
	alert(formattedHeadersString);
}


const _ENABLE_DOMAIN_RULES_CACHE = true; // if true, we cache the rules for each domain to avoid unnecessary RegExp .test calls
const cachedDomainRulesPair = new Map(); // cache for domain rules to avoid unnecessary RegExp .test calls

// TODO: no error handling whatsoever in this function
// this is a performance critical function so we should not have any try/catch blocks in it as it would slow down the execution time of this function, so we try to
function onBeforeSendHeaders(details) {
	// const startTime = performance.now(); const decimals = 10;

	const cachedRulesLength = cachedRules.length;
	const initiatorIsUs = details.initiator?.includes('chrome-extension://');
	if (cachedRulesLength === 0) {
		if (initiatorIsUs) requestHeaderInspector(details.requestHeaders);
		//console.log(`onBeforeSendHeaders took ${(performance.now() - startTime).toFixed(decimals)}ms for URL: ${details.url} with no rules.`);
		return { requestHeaders: details.requestHeaders }; 
	}

	let rulesMatchingDomain = _ENABLE_DOMAIN_RULES_CACHE ? (cachedDomainRulesPair.get(details.url)) : [];
	
	if (!_ENABLE_DOMAIN_RULES_CACHE || rulesMatchingDomain === undefined) {
		rulesMatchingDomain = [];
		for (let i = 0; i < cachedRulesLength; i++) {
			const rule = cachedRules[i];
			for (let j = 0; j < rule.domains.length; j++) {
				// NOTE: this speeds up the matching process significantly for subsequent repeated requests
				// on the same page we're currently at, at the cost of a tiny bit of memory usage and compute time
				// if this is used, cachedDomainRulesPair needs to be cleared when the rules are updated (inside asyncUpdateCachedRules)
				// TODO: benchmark this

				// NOTE: since new RegExp(location.href).test(location.href) will not always return true
				// we have to check if its a direct match via the .source property of the 
				// RegExp object against the current request url if its a literal match
				const isDomainLiteralMatch = rule.domains[j].source === details.url;
				if (isDomainLiteralMatch) {	
					if (_ENABLE_DOMAIN_RULES_CACHE) {
						// FIXME: implement better check to ensure we only have the literal match rule in the cache
						// this is an issue if the literal match rule wasnt the first item to match the current request url
						// and we have a regex match rule that also matches the current request url
						if (rulesMatchingDomain.length > 1) {
							cachedDomainRulesPair.set(details.url, [rule]);
							rulesMatchingDomain = [rule];
						}
						else {
							rulesMatchingDomain.push(rule);
							cachedDomainRulesPair.set(details.url, rulesMatchingDomain);
						}
					}
					else {
						rulesMatchingDomain.push(rule);
					}
					
					// NOTE: always use direct matches over regular expression matches, no need to check for more domain matches
					break;
				}
				else {
					const isRegexMatch = rule.domains[j].test(details.url);
					if (isRegexMatch) {
						rulesMatchingDomain.push(rule);
						if (_ENABLE_DOMAIN_RULES_CACHE) {
							cachedDomainRulesPair.set(details.url, rulesMatchingDomain);
						}
					}
					// NOTE: if we only have regex matches, keep checking for more matches
					// figure out if this is the appropriate behaviour we want
				}
			}
		}
	}
	
	const rulesMatchingDomainLength = rulesMatchingDomain.length;
	if (rulesMatchingDomainLength === 0) {
		if (initiatorIsUs) requestHeaderInspector(details.requestHeaders);
		//console.log(`onBeforeSendHeaders took ${(performance.now() - startTime).toFixed(decimals)}ms for URL: ${details.url} with no rules matching the domain.`);

		// NOTE: prevent having to look through the rules again for this url (until the cache is cleared)
		if (_ENABLE_DOMAIN_RULES_CACHE) cachedDomainRulesPair.set(details.url, rulesMatchingDomain);
		return { requestHeaders: details.requestHeaders }; 
	}

	for (let k = 0; k < rulesMatchingDomainLength; k++) {
		const rule = rulesMatchingDomain[k];
		const ruleHeadersLength = rule.headers.length;

		for (let l = 0; l < ruleHeadersLength; l++) {
			const header = rule.headers[l];
			const headerIndex = details.requestHeaders.findIndex(h => h.name.toLowerCase() === header.name);
			const headerPresentInRequest = headerIndex > -1;

			if (headerPresentInRequest) {
				if (!header.value) {
					// If the header value is empty but header.name exists remove the header completely from the main request headers
					details.requestHeaders.splice(headerIndex, 1);
				}
				else {
					// Update the existing header value in our main request headers with our own header value
					details.requestHeaders[headerIndex].value = header.value;
				}
			}
			else {
				if (header.value) {
					// header.name was not present in the main request headers but header.value was something so we force add it to the request headers
					details.requestHeaders.push({ name: header.name, value: header.value });
				}
			}

			// TODO: should we limit each header to only be allowed to be changed once?
			// ie. if we have multiple rules that contain the same header, but with perhaps a different value
			// this is a non issue if we only allow one rule per domain (see comment in the first loop where we check if a regular expression for a domain matches the current request URL)
		}
	}
	
	if (initiatorIsUs) requestHeaderInspector(details.requestHeaders);
	//console.log(`onBeforeSendHeaders took ${(performance.now() - startTime).toFixed(decimals)}ms for URL: ${details.url} with ${rulesMatchingDomainLength} rule(s) matching the domain.`);
	return { requestHeaders: details.requestHeaders }; 
}

function _onBeforeSendHeaders(details) {
	const rulesLength = cachedRules.length;
	for (let i = 0; i < rulesLength; i++) {
		const rule = cachedRules[i];
		const matchesDomain = rule.domains.some(domain => domain.test(details.url));
		if (matchesDomain) {
			const headersLength = rule.headers.length;
			for (let j = 0; j < headersLength; j++) {
				const header = rule.headers[j];
				const headerIndex = details.requestHeaders.findIndex(h => h.name.toLowerCase() === header.name);
				const headerPresentInRequest = headerIndex > -1;

				if (headerPresentInRequest) {
					if (!header.value) {
						// If the header value is empty but header.name exists
						// remove the header completely from the main request headers
						details.requestHeaders.splice(headerIndex, 1);
					}
					else {
						// Update the existing header value in our main request headers with our own header value
						details.requestHeaders[headerIndex].value = header.value;
					}
				}
				else {
					if (!header.value) {
						// header.name was not present in the main request headers
						// and header.value was nothing
						// so we do NOT add it to the request headers
					}
					else {
						// header.name was not present in the main request headers
						// but header.value was something
						// so we force add it to the request headers
						details.requestHeaders.push({ name: header.name, value: header.value });
					}
				}
			}
		}
	}

	// Check the request headers AFTER we have done our modifications (if any)
	
	if (details.initiator?.includes('chrome-extension://')) {
		requestHeaderInspector(details.requestHeaders);
    }

	return { requestHeaders: details.requestHeaders }; 
}

_browser.storage.onChanged.addListener((changes, namespace) => {
	if (namespace === 'local' && changes.rules) {
		initListeners();
	}
});

// This is only needed to handle the case when the user clicks the "Check HTTP Headers" button in the popup
_browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
	switch(message.action) {
		case 'checkrequests':
			let url = message.value;
			if (!url) return;

			// TODO: assert url is a valid URL
			if (!url.startsWith('http://') && !url.startsWith('https://')) {
				url = `https://${url}`; // Default to https if no protocol is specified
			}
			

			// Send a request to the URL to trigger the onBeforeSendHeaders listener
			// and we catch this specific request in our listener by checking the initiator
			fetch(url)
			.then(response => { })
			.catch(err => { alert(`Failed to inspect HTTP headers sent to ${url}`); console.error(err); });
			break;
	}
	// Keep message channel open for async response
	sendResponse({ status: 'ok' });
	return true;
});


initListeners();