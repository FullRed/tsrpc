import * as http from "http";
import { BaseServiceType } from "tsrpc-proto";
import { ApiCall } from "../base/ApiCall";
import { BaseConnection, BaseConnectionOptions, ConnectionStatus } from '../base/BaseConnection';
import { PrefixLogger } from "../models/PrefixLogger";
import { ApiCallHttp } from "./ApiCallHttp";
import { HttpServer } from './HttpServer';
import { MsgCallHttp } from "./MsgCallHttp";

export interface HttpConnectionOptions<ServiceType extends BaseServiceType> extends BaseConnectionOptions<ServiceType> {
    server: HttpServer<ServiceType>,
    httpReq: http.IncomingMessage,
    httpRes: http.ServerResponse,
}

export class HttpConnection<ServiceType extends BaseServiceType = any> extends BaseConnection<ServiceType> {
    readonly type = 'SHORT';

    readonly httpReq: http.IncomingMessage;
    readonly httpRes: http.ServerResponse;
    readonly server!: HttpServer<ServiceType>;
    /**
     * Whether the transportation of the connection is JSON encoded instead of binary encoded.
     */
    readonly isJSON: boolean | undefined;

    /** 
     * In short connection, one connection correspond one call.
     * It may be `undefined` when the request data is not fully received yet.
     */
    call?: ApiCallHttp | MsgCallHttp;

    constructor(options: HttpConnectionOptions<ServiceType>) {
        super(options, new PrefixLogger({
            logger: options.server.logger,
            prefixs: [`${options.ip} #${options.id}`]
        }));

        this.httpReq = options.httpReq;
        this.httpRes = options.httpRes;
    }


    public get status(): ConnectionStatus {
        if (this.httpRes.writableFinished) {
            return ConnectionStatus.Closed;
        }
        else if (this.httpRes.writableEnded) {
            return ConnectionStatus.Closing;
        }
        else {
            return ConnectionStatus.Opened;
        }
    }

    /**
     * {@inheritDoc BaseConnection.sendBuf}
     * @internal
     */
    protected async _sendData(data: string | Uint8Array, call?: ApiCall): Promise<{ isSucc: true; } | { isSucc: false; errMsg: string; }> {
        this.httpRes.end(typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength));
        return { isSucc: true }
    }

    /**
     * Close the connection, the reason would be attached to response header `X-TSRPC-Close-Reason`.
     */
    close(reason?: string) {
        if (this.status !== ConnectionStatus.Opened) {
            return;
        }

        // 有Reason代表是异常关闭
        if (reason) {
            this.logger.warn(this.httpReq.method, this.httpReq.url, reason);
        }
        reason && this.httpRes.setHeader('X-TSRPC-Close-Reason', reason);
        this.httpRes.end();
    }
}