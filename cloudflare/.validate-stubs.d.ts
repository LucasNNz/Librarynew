type CompressionFormat = "gzip"|"deflate"|"deflate-raw";
interface D1Result<T=unknown>{results:T[];success:boolean;meta:{changes?:number;[key:string]:unknown}}
interface D1PreparedStatement{bind(...v:unknown[]):D1PreparedStatement;first<T=Record<string,unknown>>():Promise<T|null>;all<T=Record<string,unknown>>():Promise<D1Result<T>>;run():Promise<{success:boolean;meta:{changes?:number}}>;raw<T=unknown>():Promise<T[]>}
interface D1Database{prepare(sql:string):D1PreparedStatement;batch<T=unknown>(s:D1PreparedStatement[]):Promise<D1Result<T>[]>;exec(sql:string):Promise<unknown>}
interface R2Object{key:string;size:number;etag:string;httpEtag:string;uploaded:Date;httpMetadata?:Record<string,unknown>;customMetadata?:Record<string,string>}
interface R2ObjectBody extends R2Object{body:ReadableStream<Uint8Array>;arrayBuffer():Promise<ArrayBuffer>;text():Promise<string>;writeHttpMetadata(headers:Headers):void}
interface R2Bucket{get(key:string):Promise<R2ObjectBody|null>;head(key:string):Promise<R2Object|null>;put(key:string,value:ReadableStream<Uint8Array>|Uint8Array|ArrayBuffer|string,opts?:unknown):Promise<R2Object|null>;delete(key:string|string[]):Promise<void>;list(opts?:{prefix?:string;limit?:number;cursor?:string;include?:Array<"httpMetadata"|"customMetadata">}):Promise<{objects:R2Object[];truncated:boolean;cursor?:string}>}
interface Message<T>{body:T;ack():void;retry(opts?:{delaySeconds?:number}):void}
interface MessageBatch<T>{messages:Message<T>[]}
interface MessageSendRequest<T>{body:T;contentType?:string;delaySeconds?:number}
interface Queue<T>{send(message:T,opts?:unknown):Promise<void>;sendBatch(messages:MessageSendRequest<T>[]):Promise<void>;metrics():Promise<{backlogCount:number}>}
interface ExecutionContext{waitUntil(p:Promise<unknown>):void;passThroughOnException():void}
declare module "@modelcontextprotocol/server" { export class McpServer { constructor(v:unknown); registerTool(name:string,def:unknown,cb:(input:any)=>any):void } }
declare module "agents/mcp/server" { export function createMcpHandler(factory:()=>unknown,opts:unknown):(req:Request,env:unknown,ctx:ExecutionContext)=>Promise<Response>|Response }
declare module "zod" { export const z:any }
interface Cache{match(request:Request):Promise<Response|undefined>;put(request:Request,response:Response):Promise<void>}
interface CacheStorage{readonly default:Cache}
declare const caches: CacheStorage;
