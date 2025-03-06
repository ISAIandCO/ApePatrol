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


console.log("aaaaaaa"); 
originalSend = window.XMLHttpRequest.prototype.send;
window.XMLHttpRequest.prototype.send = overridedSend;
options = globalMonkeyOptions;

function overridedSend(data){
    if(this.onreadystatechange){
       this._onreadystatechange = this.onreadystatechange;
    }
    
      if(this.__zone_symbol__xhrURL) {   
      //console.log(options);    
        if(this.__zone_symbol__xhrURL.includes('/api/edr/assets')) {
          if('options' in options && 'disable_edr_integration' in options.options && options.options.disable_edr_integration == true) {
              console.log("No EDR - no problems");
              return;
              //throw new Error("edr integration is not ready yet!");
          }
        }
      }
     
     
    if('options' in options && 
          ('disable_agg_sort' in options.options && options.options.disable_agg_sort == true ||
           'add_input_for_IOCs_description' in options.options && options.options.add_input_for_IOCs_description == true) 
    ){
      if(data !== null){
        try {
          console.log(options);
          if(this.__zone_symbol__xhrURL) {
            
              // console.log(this.__zone_symbol__xhrURL);
              if(this.__zone_symbol__xhrURL.includes('/api/whitelists/') &&  this.__zone_symbol__xhrURL.includes('/insert'))
              {
                let params = JSON.parse(data); 
                let description_node = document.querySelector(".iocs_description");
                let description = description_node.value;
                let user = description_node.getAttribute("user"); //имя пользователя, который внес изменения
                let token = description_node.getAttribute("token"); //token табличного списка, куда будет добавляться описание
                if(this.__zone_symbol__xhrURL.includes(token)) {
                  params[2] = `${description} (${user})`; //'Каждый незаполненый дескрипшен заставляет грустить одного аналитика в SOC'
                  data = JSON.stringify(params);
                }
              }
            }            
            // console.log(data);
            // код ниже нужен для удаления параметра, задающего сортировку, которая подходит не всем 
            // (управляется из парамтеров расширения)
            let params = JSON.parse(data); 
            // удалим ненужную сортировку
            delete params.filter.groupByOrder; // удаляем 
            data = JSON.stringify(params);
          }
          catch (error) {
              //console.log(error);
              ; //просто пропустим ошибку, какой она бы не была, 
                // наверняка просто попался какой-то запрос с параметрами другого формата
                // TODO: наверное стоит делать нормально, но пока и так сойдет
        }

          // console.log(data);
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
