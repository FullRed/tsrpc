import { TransportDataUtil } from "tsrpc-base-client";
import { BaseServiceType } from "tsrpc-proto";
import { PrefixLogger } from "../models/PrefixLogger";
import { ApiCall } from "./ApiCall";
import { BaseServer } from "./BaseServer";

export interface BaseConnectionOptions<ServiceType extends BaseServiceType = any> {
    /** Created by server, each Call has a unique id. */
    id: string;
    /** Client IP address */
    ip: string,
    server: BaseServer<ServiceType>,
    dataType: 'text' | 'buffer'
}

export abstract class BaseConnection<ServiceType extends BaseServiceType = any> {
    /** It is long connection or short connection */
    abstract readonly type: 'LONG' | 'SHORT';

    /** Connection unique ID */
    readonly id: string;
    /** Client IP address */
    readonly ip: string;
    readonly server: BaseServer<ServiceType>;
    readonly logger: PrefixLogger;
    readonly dataType: BaseConnectionOptions['dataType'];

    constructor(options: BaseConnectionOptions<ServiceType>, logger: PrefixLogger) {
        this.id = options.id;
        this.ip = options.ip;
        this.server = options.server;
        this.logger = logger;
        this.dataType = options.dataType;
    }

    abstract get status(): ConnectionStatus;
    /** Close the connection */
    abstract close(reason?: string): void;

    /** Send buffer (with pre-flow and post-flow) */
    async sendData(data: string | Uint8Array, call?: ApiCall): Promise<{ isSucc: true } | { isSucc: false, errMsg: string }>{
        // Pre Flow
        let pre = await this.server.flows.preSendDataFlow.exec({ conn: this, data: data, call: call }, call?.logger || this.logger);
        if (!pre) {
            return { isSucc: false, errMsg: 'preSendBufferFlow Error' };
        }
        data = pre.data;

        // @deprecated Pre Buffer Flow
        if (typeof data !== 'string') {
            let preBuf = await this.server.flows.preSendBufferFlow.exec({ conn: this, buf: data, call: call }, call?.logger || this.logger);
            if (!preBuf) {
                return { isSucc: false, errMsg: 'preSendBufferFlow Error' };
            }
            data = preBuf.buf;
        }

        this.server.options.debugBuf && this.logger.debug(typeof data === 'string' ? '[SendText]' : '[SendBuf]', data);
        return this._sendData(data, call);
    }
    protected abstract _sendData(data: string | Uint8Array, call?: ApiCall): Promise<{ isSucc: true } | { isSucc: false, errMsg: string }>;

    /**
     * Send message to the client, only be available when it is long connection.
     * @param msgName 
     * @param msg - Message body
     * @returns Promise resolved when the buffer is sent to kernel, it not represents the server received it.
     */
    async sendMsg<T extends keyof ServiceType['msg']>(msgName: T, msg: ServiceType['msg'][T]): Promise<{ isSucc: true } | { isSucc: false, errMsg: string }> {
        if (this.type === 'SHORT') {
            this.logger.warn('[SendMsgErr]', `[${msgName}]`, 'Short connection cannot sendMsg');
            return { isSucc: false, errMsg: 'Short connection cannot sendMsg' }
        }

        let service = this.server.serviceMap.msgName2Service[msgName as string];
        if (!service) {
            this.logger.warn('[SendMsgErr]', `[${msgName}]`, `Invalid msg name: ${msgName}`);
            return { isSucc: false, errMsg: `Invalid msg name: ${msgName}` }
        }

        // Pre Flow
        let pre = await this.server.flows.preSendMsgFlow.exec({ conn: this, service: service, msg: msg }, this.logger);
        if (!pre) {
            return { isSucc: false, errMsg: 'sendMsg prevent by preSendMsgFlow' };
        }
        msg = pre.msg;

        // Encode
        let opServerOutput = TransportDataUtil.encodeServerMsg(this.server.tsbuffer, service, msg, this.dataType, this.type);
        if (!opServerOutput.isSucc) {
            this.logger.warn('[SendMsgErr]', `[${msgName}]`, opServerOutput.errMsg);
            return opServerOutput;
        }

        // Do send!
        this.server.options.logMsg && this.logger.log('[SendMsg]', `[${msgName}]`, msg);
        let opSend = await this.sendData(opServerOutput.output);
        if (!opSend.isSucc) {
            return opSend;
        }

        // Post Flow
        await this.server.flows.postSendMsgFlow.exec(pre, this.logger);

        return { isSucc: true };
    }
}

export enum ConnectionStatus {
    Opened = 'OPENED',
    Closing = 'CLOSING',
    Closed = 'CLOSED'
}