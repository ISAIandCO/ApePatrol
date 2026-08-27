//    Copyright 2025 Konstantin Grishchenko, Security Experts Community
//
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
//
//        http://www.apache.org/licenses/LICENSE-2.0
//
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.


options = {};

async function GetOptionsFromStorage() {
    options  = await getStorageData('options');
}
  
const getStorageData = key =>
    new Promise((resolve, reject) =>
        chrome.storage.sync.get(key, result =>
          chrome.runtime.lastError
            ? reject(Error(chrome.runtime.lastError.message))
            : resolve(result)
        )
    )  

function  sendSiemMonkeyOptions(param) {
    window.globalMonkeyOptions = param;
}

chrome.webNavigation.onDOMContentLoaded.addListener(async ({ tabId, url }) => {
    GetOptionsFromStorage().then(() => {
        // console.log(options);
        
        chrome.scripting.executeScript({ 
            target: { tabId },
            func: sendSiemMonkeyOptions,
            args: [options],
            world: "MAIN"
         });
        
        chrome.scripting.executeScript({
            target: { tabId },
            files: ['xhr_override.js'],
            world: "MAIN"
        });
    });
});
