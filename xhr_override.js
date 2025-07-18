//    Copyright 2023 Konstantin Grishchenko, Security Experts Community
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

console.log(window.XMLHttpRequest.prototype.send);
if(!(window.XMLHttpRequest.prototype.send.toString() === overridedSend.toString()))
{
  originalSend = window.XMLHttpRequest.prototype.send;
  window.XMLHttpRequest.prototype.send = overridedSend;
}
options = globalMonkeyOptions;

function overridedSend(data){
    if(this.onreadystatechange){
       this._onreadystatechange = this.onreadystatechange;
    }
    
      if(this.__zone_symbol__xhrURL) {   
        //console.log(options);    
        if(this.__zone_symbol__xhrURL.includes('/api/edr/assets')) {
          if('options' in options && 'disable_edr_integration' in options.options && options.options.disable_edr_integration == true) {
              //console.log("An apple a day keeps the doctor away :)");
              return;
          }
        }
      
        if(this.__zone_symbol__xhrURL.includes('/api/whitelists/') && this.__zone_symbol__xhrURL.includes('/insert')
           && 'add_input_for_IOCs_description' in options.options && options.options.add_input_for_IOCs_description == true) {
            let params = JSON.parse(data); 
            let description_node = document.querySelector(".iocs_description");
            if (description_node == null) {
              let ips_shell_remote_app_node = document.querySelector("ips-shell-remote-app");
              let siem_core_node = ips_shell_remote_app_node.shadowRoot.querySelector("siem-core");
              description_node = siem_core_node.shadowRoot.querySelector(".iocs_description")
            }
            let description = ""; // если не найдется элемент с описанием, то используем пустую стоку, чтобы не падать, а то больно
            if (description_node != null) {
              description = description_node.value;
            }
            let user = description_node.getAttribute("user"); //имя пользователя, который внес изменения
            let token = description_node.getAttribute("token"); //token табличного списка, куда будет добавляться описание
            if(this.__zone_symbol__xhrURL.includes(token)) {
              params[2] = `${description} (${user})`; //'Каждый незаполненый дескрипшен заставляет грустить одного аналитика в SOC'
              data = JSON.stringify(params);
            }
          }
    }
    this.onreadystatechange = onReadyStateChangeReplacement;
    return originalSend.apply(this, arguments);
}

function onReadyStateChangeReplacement(){
    if(this._onreadystatechange){
      return this._onreadystatechange.apply(this, arguments);
   }
}
