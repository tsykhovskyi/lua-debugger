import {
  Action,
  DebuggerState,
  ErrorResponse,
  FinishedResponse,
  Response,
  RunningResponse,
  SessionInterface
} from "./session.interface";
import { LuaDebuggerInterface, Variable } from "../ldb/lua-debugger-interface";
import EventEmitter from "events";
import { randomUUID } from "crypto";

export class Session extends EventEmitter implements SessionInterface {
  id: string;
  state: DebuggerState = DebuggerState.Pending;
  result: FinishedResponse | ErrorResponse | null = null;

  watchVars: Set<string> = new Set();

  constructor(private connection: LuaDebuggerInterface, watch: string[] = []) {
    super();
    this.id = randomUUID();
    this.watchVars = new Set(watch);
    this.connection.on('finished', result => this.emit('finished', result));
    this.connection.on('error', error => this.emit('error', error));
  }

  async init() {
    await this.connection.init();
    this.state = DebuggerState.Running;
  }

  async finished(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.once('finished', (result) => resolve(result));
      this.once('error', (error) => reject(error));
    });
  }

  async execAction(action: Action | null, values: string[]): Promise<Response> {
    if (this.state === DebuggerState.Pending) {
      return { state: DebuggerState.Pending };
    }

    if (this.result !== null) {
      return this.result;
    }

    try {
      const cmdResponse = await this.handleAction(action, values);
      if (this.connection.isFinished) {
        return this.result = { state: DebuggerState.Finished, result: cmdResponse };
      }

      const sourceCode = await this.connection.whole();
      const variables = await this.connection.print();
      const trace = await this.connection.trace();
      const watch = await this.handleWatch();

      return <RunningResponse>{
        state: DebuggerState.Running,
        cmdResponse,
        sourceCode,
        watch,
        variables,
        trace,
      }
    } catch (error: any) {
      return this.result = { state: DebuggerState.Error, error: error.toString() };
    }
  }

  private async handleAction(action: Action | null, values: string[]): Promise<string[]> {
    switch (action) {
      case Action.None:
        return [];
      case Action.Step:
        return this.connection.step();
      case Action.Continue:
        return this.connection.continue();
      case Action.Abort:
        return this.connection.abort();
      case Action.Restart:
        return this.connection.restart();
      case Action.AddBreakpoint:
        return this.connection.addBreakpoint(Number(values[0]));
      case Action.RemoveBreakpoint:
        return this.connection.removeBreakpoint(Number(values[0]));
      case Action.AddWatch:
        this.watchVars.add(values[0].trim());
        return [];
      case Action.RemoveWatch:
        this.watchVars.delete(values[0].trim());
        return [];
    }
    throw new Error('Unsupported command');
  }

  private async handleWatch(): Promise<Variable[]> {
    const watch: Variable[] = [];
    for (const variable of this.watchVars) {
      const result = await this.connection.print(variable);
      watch.push({
        name: variable,
        value: result[0]?.value ?? null,
      })
    }
    return watch;
  }
}
