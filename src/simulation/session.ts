import { applyCommand, step } from "./engine";
import type { Command, CommandResult, World } from "./types";
/** Future transports send commands to an authority; rendering never mutates simulation state. */
export interface GameSession {
  readonly world: World;
  dispatch(command: Command): CommandResult;
  advance(): void;
}
export interface CommandEnvelope {
  playerId: string;
  sequence: number;
  tick: number;
  command: Command;
}
export interface SnapshotEnvelope {
  revision: number;
  world: World;
}
export class LocalSession implements GameSession {
  revision = 0;
  constructor(public readonly world: World) {}
  dispatch(command: Command) {
    const result = applyCommand(this.world, command);
    if (result.ok) this.revision++;
    return result;
  }
  advance() {
    step(this.world);
    this.revision++;
  }
}
