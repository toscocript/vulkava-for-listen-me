import { Node, Vulkava } from '..';
import { PlayerOptions, PlayerState, PlayOptions, VoiceState } from './@types';
import { NodeState } from './Node';
import Track from './Track';

enum State {
  DISCONNECTED,
  CONNECTING,
  CONNECTED
}

export default class Player {
  private readonly vulkava: Vulkava;
  public node: Node;

  public readonly guildId: string;

  public voiceChannelId: string;
  public textChannelId?: string | null;

  public selfDeaf?: boolean;
  public selfMute?: boolean;

  public current: Track | null;
  public queue: Track[];

  public queueRepeat: boolean;
  public trackRepeat: boolean;

  public position: number;
  private positionTimestamp: number;

  public playing: boolean;
  public paused: boolean;

  public state: State;
  public voiceState: VoiceState;

  public moving: boolean;

  constructor(vulkava: Vulkava, options: PlayerOptions) {
    // TODO: verify input
    this.vulkava = vulkava;
    this.guildId = options.guildId;

    this.voiceChannelId = options.voiceChannelId;
    this.textChannelId = options.textChannelId ?? null;

    this.selfDeaf = options.selfDeaf ?? false;
    this.selfMute = options.selfMute ?? false;

    this.current = null;
    this.queue = [];

    this.queueRepeat = false;
    this.trackRepeat = false;

    this.position = 0;
    this.positionTimestamp = 0;

    this.playing = false;
    this.paused = false;

    this.node = this.vulkava.nodes.filter(n => n.state === NodeState.CONNECTED).sort((a, b) => a.stats.players - b.stats.players)[0];

    this.state = State.DISCONNECTED;
    this.voiceState = {} as VoiceState;
  }

  /**
   * Gets the exact track position based on the last voiceUpdate packet
   */
  get exactPosition(): number {
    return this.position + (Date.now() - this.positionTimestamp);
  }

  /**
   * Connects to the voice channel
   */
  public connect() {
    if (this.state === State.CONNECTED) return;

    if (this.node === null) {
      throw new Error('No available nodes!');
    }

    if (!this.voiceChannelId) {
      throw new Error('No voice channel id provided');
    }

    this.state = State.CONNECTING;

    this.vulkava.sendWS(this.guildId, {
      op: 4,
      d: {
        guild_id: this.guildId,
        channel_id: this.voiceChannelId,
        self_mute: this.selfMute,
        self_deaf: this.selfDeaf
      }
    });
  }

  /**
   * Disconnects from the voice channel
   */
  public disconnect() {
    if (this.state === State.DISCONNECTED) return;

    this.vulkava.sendWS(this.guildId, {
      op: 4,
      d: {
        guild_id: this.guildId,
        channel_id: null
      }
    });

    this.state = State.DISCONNECTED;
  }

  /**
   * Destroys the player
   */
  public destroy() {
    this.disconnect();

    this.node.send({
      op: 'destroy',
      guildId: this.guildId
    });

    this.vulkava.players.delete(this.guildId);
  }

  /**
   * @param {Node} node - The node to move the player to
   */
  public moveNode(node: Node) {
    if (!node) throw new TypeError('You must provide a Node instance.');
    if (node.state !== NodeState.CONNECTED) throw new Error('The provided node is not connected.');
    if (this.node === node) return;

    this.moving = true;

    this.node.send({
      op: 'destroy',
      guildId: this.guildId,
    });

    this.node = node;

    if (Object.keys(this.voiceState).length) {
      this.state = State.CONNECTING;

      this.sendVoiceUpdate();

      this.state = State.CONNECTED;
    }

    // TODO: Re-apply the filters

    if (this.playing && this.current) {
      const payload = {
        op: 'play',
        guildId: this.guildId,
        track: this.current.encodedTrack,
        startTime: this.position
      };

      this.node.send(payload);
    } else {
      this.moving = false;
    }
  }

  /**
   * Gets the latency between discord gateway & lavalink node.
   * @returns {Promise<Number>}
   */
  public ping(): Promise<number> {
    return this.node.ping(this.guildId);
  }

  /**
   * Plays a track
   * @param {Object} [options] - Play options
   * @param {Number} [options.startTime] - Start time in milliseconds
   * @param {Number} [options.endTime] - End time in milliseconds
   * @param {Boolean} [options.noReplace] - Whether to ignore operation if a track is already playing or paused
   */
  public play(options?: PlayOptions) {
    if (this.node === null) {
      throw new Error('No available nodes!');
    }

    if (!this.current && !this.trackRepeat && !this.queue.length) {
      throw new Error('The queue is empty!');
    }

    if (!this.current) {
      this.current = this.queue.shift() as Track;
    } else if (!this.trackRepeat) {
      this.current = this.queue.shift() as Track;
    }

    this.node.send({
      op: 'play',
      guildId: this.guildId,
      track: this.current.encodedTrack,
      ...options
    });
  }

  /**
   * Sets the track looping
   * @param {Boolean} state - Whether to enable track looping or not
   */
  public setTrackLoop(state: boolean) {
    this.trackRepeat = state;
  }

  /**
   * Sets the queue looping
   * @param {Boolean} state - Whether to enable queue looping or not
   */
  public setQueueLoop(state: boolean) {
    this.queueRepeat = state;
  }

  /**
   * Skips the current playing track
   * @param {Number} [amount=1] - The amount of tracks to skip
   */
  public skip(amount = 1) {
    if (!this.playing) return;

    if (amount >= this.queue.length) {
      this.queue = [];
    } else {
      this.queue.splice(0, amount);
    }

    this.node.send({
      op: 'stop',
      guildId: this.guildId
    });
  }

  /**
   * Pause or unpause the player
   * @param {Boolean} [state=true] - Whether to pause or unpause the player
   */
  public pause(state = true) {
    if (typeof state !== 'boolean') {
      throw new TypeError('State must be a boolean');
    }

    this.paused = state;

    this.node.send({
      op: 'pause',
      guildId: this.guildId,
      pause: state
    });
  }

  /**
   * Seek to a specific position in the track
   * @param {Number} position - The position to seek, in milliseconds
   */
  public seek(position: number) {
    if (!this.playing || !this.current) return;
    if (typeof position !== 'number') {
      throw new TypeError('Position must be a number');
    }

    if (position > this.current.duration) {
      this.skip();
      return;
    }

    this.node.send({
      op: 'seek',
      guildId: this.guildId,
      position
    });
  }

  public sendVoiceUpdate() {
    this.node.send({
      op: 'voiceUpdate',
      guildId: this.guildId,
      ...this.voiceState
    });
  }

  public updatePlayer(state: PlayerState): void {
    if (state.position) this.position = state.position;

    if (state.connected) {
      if (this.state !== State.CONNECTED) this.state = State.CONNECTED;
    } else if (this.state !== State.DISCONNECTED) {
      this.state = State.DISCONNECTED;
    }
  }
}