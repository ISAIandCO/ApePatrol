import { escapePdqlString, formatPdqlValue } from "../../shared/pdql/escape.js";

export const BUILTIN_FILTERS = Object.freeze([
  { id: "host-events", name: "Все события узла", description: "Показывает активность выбранного узла вокруг текущего события.", template: "event_src.host = '${event_src.host}'", timeRange: "1h", enabled: true },
  { id: "event-uuid", name: "Текущее событие по UUID", description: "Находит конкретное исходное событие независимо от открытой карточки.", template: "uuid = '${uuid}'", timeRange: "5m", enabled: true },
  { id: "msgid-host", name: "Такой же тип события на узле", description: "Ищет тот же msgid на текущем узле — удобно для повторяющихся запусков и ошибок.", template: "(event_src.host = '${event_src.host}') and (msgid = ${msgid})", timeRange: "24h", enabled: true },
  { id: "msgid-global", name: "Такой же тип события во всей области", description: "Ищет текущий msgid без ограничения по узлу.", template: "msgid = ${msgid}", timeRange: "1h", enabled: true },
  { id: "account-events", name: "Активность учётной записи", description: "Ищет учётную запись одновременно в роли субъекта и объекта.", template: "(subject.account.name = '${subject.account.name}') or (object.account.name = '${subject.account.name}')", timeRange: "24h", enabled: true },
  { id: "account-on-host", name: "Учётная запись на текущем узле", description: "Ограничивает активность учётной записи выбранным узлом.", template: "(event_src.host = '${event_src.host}') and ((subject.account.name = '${subject.account.name}') or (object.account.name = '${subject.account.name}'))", timeRange: "24h", enabled: true },
  { id: "ip-connections", name: "Активность исходного IP", description: "Ищет исходный IP в обеих сторонах сетевого взаимодействия.", template: "(src.ip = '${src.ip}') or (dst.ip = '${src.ip}')", timeRange: "24h", enabled: true },
  { id: "dst-ip-connections", name: "Активность адреса назначения", description: "Ищет IP назначения в полях источника и назначения.", template: "(src.ip = '${dst.ip}') or (dst.ip = '${dst.ip}')", timeRange: "24h", enabled: true },
  { id: "ip-pair", name: "Связь между двумя IP", description: "Ищет обмен между текущими src.ip и dst.ip в обоих направлениях.", template: "((src.ip = '${src.ip}') and (dst.ip = '${dst.ip}')) or ((src.ip = '${dst.ip}') and (dst.ip = '${src.ip}'))", timeRange: "24h", enabled: true },
  { id: "dst-port-host", name: "Порт назначения на узле", description: "Ищет обращения к тому же порту назначения на текущем узле.", template: "(event_src.host = '${event_src.host}') and (dst.port = ${dst.port})", timeRange: "24h", enabled: true },
  { id: "src-ip-dst-port", name: "Исходный IP и порт назначения", description: "Сужает поиск до конкретного источника и целевого порта.", template: "(src.ip = '${src.ip}') and (dst.port = ${dst.port})", timeRange: "24h", enabled: true },
  { id: "process-guid", name: "События процесса по GUID", description: "Ищет GUID процесса в ролях субъекта и объекта.", template: "(subject.process.guid = '${object.process.guid}') or (object.process.guid = '${object.process.guid}')", timeRange: "24h", enabled: true },
  { id: "subject-process-guid", name: "События subject-процесса по GUID", description: "Вариант для коллекторов, помещающих основной GUID в subject.process.guid.", template: "(subject.process.guid = '${subject.process.guid}') or (object.process.guid = '${subject.process.guid}')", timeRange: "24h", enabled: true },
  { id: "process-id-host", name: "PID на текущем узле", description: "Ищет PID только на выбранном узле, снижая риск совпадений между системами.", template: "(event_src.host = '${event_src.host}') and ((object.process.id = ${object.process.id}) or (subject.process.id = ${object.process.id}))", timeRange: "1h", enabled: true },
  { id: "parent-process-guid", name: "Дочерние процессы выбранного GUID", description: "Ищет процессы, у которых текущий GUID указан как родительский.", template: "object.process.parent.guid = '${object.process.guid}'", timeRange: "24h", enabled: true },
  { id: "process-name-host", name: "Процесс с таким именем на узле", description: "Ищет запуски процесса с тем же именем на текущем узле.", template: "(event_src.host = '${event_src.host}') and ((object.process.name = '${object.process.name}') or (subject.process.name = '${object.process.name}'))", timeRange: "7d", enabled: true },
  { id: "process-command-line", name: "Та же командная строка", description: "Ищет точное совпадение командной строки процесса.", template: "(object.process.cmdline = '${object.process.cmdline}') or (subject.process.cmdline = '${object.process.cmdline}')", timeRange: "7d", enabled: true },
  { id: "process-session", name: "Процессы той же сессии", description: "Показывает процессы текущей пользовательской или терминальной сессии на узле.", template: "(event_src.host = '${event_src.host}') and (object.account.session_id = '${object.account.session_id}')", timeRange: "24h", enabled: true },
  { id: "file-on-host", name: "Файл на текущем узле", description: "Ищет события с тем же именем объекта на выбранном узле.", template: "(event_src.host = '${event_src.host}') and (object.name = '${object.name}')", timeRange: "7d", enabled: true },
  { id: "object-path-host", name: "Объект по полному пути на узле", description: "Ищет точный путь объекта на текущем узле.", template: "(event_src.host = '${event_src.host}') and (object.path = '${object.path}')", timeRange: "7d", enabled: true },
  { id: "hash-events", name: "События с тем же хешем", description: "Ищет совпадающий object.hash во всей выбранной области поиска.", template: "object.hash = '${object.hash}'", timeRange: "30d", enabled: true },
  { id: "url-events", name: "События с тем же URL", description: "Ищет точное совпадение object.url.", template: "object.url = '${object.url}'", timeRange: "7d", enabled: true },
  { id: "domain-events", name: "События с тем же доменом", description: "Ищет домен назначения в нормализованном поле dst.domain.", template: "dst.domain = '${dst.domain}'", timeRange: "7d", enabled: true },
  { id: "correlation-rule", name: "Срабатывания того же правила", description: "Показывает другие события того же корреляционного правила.", template: "correlation_name = '${correlation_name}'", timeRange: "7d", enabled: true },
  { id: "incident-events", name: "События того же инцидента", description: "Ищет события, связанные с текущим incident_id.", template: "incident_id = '${incident_id}'", timeRange: "7d", enabled: true },
  { id: "source-product", name: "События того же продукта-источника", description: "Показывает активность того же продукта-источника на выбранном узле.", template: "(event_src.host = '${event_src.host}') and (event_src.product = '${event_src.product}')", timeRange: "24h", enabled: true },
  { id: "src-hostname", name: "Активность исходного имени узла", description: "Ищет src.hostname в событиях за длительный период.", template: "src.hostname = '${src.hostname}'", timeRange: "7d", enabled: true },
  { id: "dst-hostname", name: "Активность имени узла назначения", description: "Ищет dst.hostname в событиях за длительный период.", template: "dst.hostname = '${dst.hostname}'", timeRange: "7d", enabled: true },
  { id: "asset-id", name: "События того же актива", description: "Ищет события, связанные с текущим asset.id.", template: "asset.id = '${asset.id}'", timeRange: "7d", enabled: true },
  { id: "network-protocol", name: "Тот же протокол на узле", description: "Ищет события с тем же protocol на текущем узле.", template: "(event_src.host = '${event_src.host}') and (protocol = '${protocol}')", timeRange: "24h", enabled: true },
  { id: "src-port", name: "Исходный порт", description: "Ищет события с тем же исходным портом; полезно для анализа нестандартных сервисов и обратных соединений.", template: "src.port = ${src.port}", timeRange: "24h", enabled: true },
  { id: "dst-port", name: "Порт назначения", description: "Показывает обращения к тому же порту назначения во всей выбранной области.", template: "dst.port = ${dst.port}", timeRange: "24h", enabled: true },
  { id: "network-flow", name: "Точный сетевой поток", description: "Ищет совпадение src.ip, src.port, dst.ip, dst.port и protocol.", template: "(src.ip = '${src.ip}') and (src.port = ${src.port}) and (dst.ip = '${dst.ip}') and (dst.port = ${dst.port}) and (protocol = '${protocol}')", timeRange: "1h", enabled: true },
  { id: "src-mac", name: "Активность исходного MAC", description: "Ищет события с тем же MAC-адресом источника.", template: "src.mac = '${src.mac}'", timeRange: "7d", enabled: true },
  { id: "dst-mac", name: "Активность MAC назначения", description: "Ищет события с тем же MAC-адресом назначения.", template: "dst.mac = '${dst.mac}'", timeRange: "7d", enabled: true },
  { id: "subject-account-domain", name: "Учётная запись и домен субъекта", description: "Сужает поиск до конкретной учётной записи в её домене.", template: "(subject.account.name = '${subject.account.name}') and (subject.account.domain = '${subject.account.domain}')", timeRange: "7d", enabled: true },
  { id: "object-account", name: "Активность объектной учётной записи", description: "Ищет object.account.name одновременно среди субъектов и объектов.", template: "(subject.account.name = '${object.account.name}') or (object.account.name = '${object.account.name}')", timeRange: "7d", enabled: true },
  { id: "parent-process-id", name: "Дочерние процессы по PID родителя", description: "Ищет процессы с тем же родительским PID на текущем узле.", template: "(event_src.host = '${event_src.host}') and (object.process.parent.id = ${object.process.parent.id})", timeRange: "24h", enabled: true },
  { id: "parent-process-name", name: "Дочерние процессы того же родителя", description: "Ищет запуски, созданные процессом с тем же именем, на текущем узле.", template: "(event_src.host = '${event_src.host}') and (object.process.parent.name = '${object.process.parent.name}')", timeRange: "7d", enabled: true },
  { id: "subject-hash", name: "События с subject-хешем", description: "Ищет совпадение хеша, если коллектор размещает его в subject.hash.", template: "subject.hash = '${subject.hash}'", timeRange: "30d", enabled: true },
  { id: "object-type", name: "События того же типа объекта", description: "Показывает события с тем же object.type на текущем узле.", template: "(event_src.host = '${event_src.host}') and (object.type = '${object.type}')", timeRange: "24h", enabled: true },
  { id: "event-action", name: "То же действие события", description: "Ищет события с тем же нормализованным полем action.", template: "action = '${action}'", timeRange: "24h", enabled: true },
  { id: "event-status", name: "Тот же статус события", description: "Ищет события с таким же status у того же продукта-источника.", template: "(event_src.product = '${event_src.product}') and (status = '${status}')", timeRange: "24h", enabled: true },
  { id: "generic-category", name: "Та же общая категория", description: "Показывает события той же нормализованной category.generic.", template: "category.generic = '${category.generic}'", timeRange: "7d", enabled: true },
  { id: "registry-key-host", name: "Ключ реестра на узле", description: "Ищет обращения к тому же ключу реестра на выбранном узле.", template: "(event_src.host = '${event_src.host}') and (object.path = '${object.path}') and (object.type = 'registry_key')", timeRange: "7d", enabled: true },
  { id: "email-sender", name: "Сообщения того же отправителя", description: "Ищет события с тем же адресом отправителя электронной почты.", template: "src.email = '${src.email}'", timeRange: "30d", enabled: true },
  { id: "email-recipient", name: "Сообщения тому же получателю", description: "Ищет события с тем же адресом получателя электронной почты.", template: "dst.email = '${dst.email}'", timeRange: "30d", enabled: true },
  { id: "source-title", name: "Тот же источник событий", description: "Ищет события от того же именованного источника event_src.title.", template: "event_src.title = '${event_src.title}'", timeRange: "24h", enabled: true },
]);

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_.]*)\}/g;

export function requiredTemplateFields(template) {
  return [...new Set([...String(template).matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

export function renderFilterTemplate(template, event) {
  const missing = requiredTemplateFields(template).filter((field) => event[field] === undefined || event[field] === null || event[field] === "");
  if (missing.length) return { ok: false, missing, query: null };
  const query = String(template).replace(PLACEHOLDER, (match, field, offset, source) => {
    const value = event[field];
    const quoted = source[offset - 1] === "'" && source[offset + match.length] === "'";
    return quoted ? escapePdqlString(value) : formatPdqlValue(value);
  });
  return { ok: true, missing: [], query };
}

export function normalizeCustomFilter(filter, index = 0) {
  if (!filter || typeof filter !== "object" || typeof filter.template !== "string") return null;
  const requiredFields = requiredTemplateFields(filter.template);
  if (!requiredFields.length || filter.template.length > 4000) return null;
  return {
    id: String(filter.id || `filter-${index}`).replace(/[^a-z0-9_-]/gi, "-").slice(0, 64),
    name: String(filter.name || `Filter ${index + 1}`).slice(0, 120),
    description: String(filter.description || "Пользовательский PDQL-фильтр.").slice(0, 300),
    template: filter.template,
    requiredFields,
    timeRange: ["5m", "15m", "1h", "24h", "7d", "30d"].includes(filter.timeRange) ? filter.timeRange : "15m",
    enabled: filter.enabled !== false,
  };
}
