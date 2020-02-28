import { IPlugin, IModLoaderAPI } from 'modloader64_api/IModLoaderAPI'
import { EventHandler, EventsClient } from 'modloader64_api/EventHandler';
import fse from 'fs-extra';
import path from 'path';
import child_process from 'child_process';
import fs from 'fs';
import { IOOTCore } from 'modloader64_api/OOT/OOTAPI';
import { InjectCore } from 'modloader64_api/CoreInjection';
import { IActor } from 'modloader64_api/OOT/IActor';
import { Command } from 'modloader64_api/OOT/ICommandBuffer';
import { IPosition } from 'modloader64_api/OOT/IPosition';
import IMemory from 'modloader64_api/IMemory';

const actor_ovl_size: Map<string, number> = new Map<string, number>();

interface CatEvent {
    file: string;
    dest: string;
    meta: string;
}

class find_init {
    constructor() { }

    find(buf: Buffer, locate: string): number {
        let loc: Buffer = Buffer.from(locate, 'hex');
        if (buf.indexOf(loc) > -1) {
            return buf.indexOf(loc);
        }
        return -1;
    }
}

interface ovl_meta {
    addr: string;
    init: string;
    forceSlot: string;
}

export class OverlayHotloadPayload {

    parse(file: string, buf: Buffer, dest: IMemory) {
        console.log('Trying to allocate actor...');
        let overlay_start: number = global.ModLoader['overlay_table'];
        let finder: find_init = new find_init();
        let meta: ovl_meta = JSON.parse(
            fs.readFileSync(path.join(path.parse(file).dir, path.parse(file).name + '.json')).toString()
        );
        let offset: number = finder.find(buf, meta.init);
        if (offset === -1) {
            console.log(
                'Failed to find spawn parameters for actor ' +
                path.parse(file).base +
                '.'
            );
            return -1;
        }
        let addr: number = parseInt(meta.addr) + offset;
        let slot: number = parseInt(meta.forceSlot);
        console.log(
            'Assigning ' + path.parse(file).base + ' to slot ' + slot + '.'
        );
        dest.rdramWrite32(0x80000000 + addr, slot * 0x20 + overlay_start + 0x14);
        buf.writeUInt8(slot, offset + 0x1);
        if (actor_ovl_size.has(file)) {
            dest.rdramWriteBuffer(addr, Buffer.alloc(actor_ovl_size.get(file)!));
        }
        dest.rdramWriteBuffer(parseInt(meta.addr), buf)
        return slot;
    }
}

class CatBinding implements IPlugin {

    ModLoader!: IModLoaderAPI;
    pluginName?: string | undefined;
    @InjectCore()
    core!: IOOTCore;
    private readonly actor_array_addr: number = 0x001c30;
    private readonly actor_next_offset: number = 0x124;
    private actors_pointers_this_frame: number[] = new Array<number>();
    private relevant_ids: number[] = [];
    private last_pos: Map<number, IPosition> = new Map<number, IPosition>();
    private temp: string = "";

    constructor() { }

    preinit(): void {
        this.temp = fse.mkdtempSync("ModLoader64_temp_");
    }

    init(): void {
    }

    postinit(): void {
    }

    onTick(frame?: number | undefined): void {
    }

    @EventHandler(EventsClient.ON_INJECT_FINISHED)
    onPost() {
        fse.readdirSync(global.ModLoader["startdir"]).forEach((file: string) => {
            if (path.parse(file).ext === ".c") {
                let p: string = path.resolve(path.join(global.ModLoader["startdir"], file));
                this.injectActor(p);
                fse.watchFile(p, () => {
                    this.injectActor(p);
                });
            }
        });
    }

    @EventHandler("CatBinding:CompileActor")
    onCompileActor(evt: CatEvent) {
        this.compileActor(evt.file, evt.dest, evt.meta);
    }

    compileActor(file: string, dest: string, meta: string) {
        let p: string = path.resolve(path.join(this.temp, "temp.c"));
        fse.copyFileSync(path.resolve(file), p);
        let original_dir: string = process.cwd();
        process.chdir(global.ModLoader["startdir"] + "/CustomActorToolkit");
        let command: string = "";
        let addr: string = "0x" + (0x80000000 + parseInt(JSON.parse(fse.readFileSync(path.resolve(meta)).toString()).addr)).toString(16);
        command += "@echo off\n";
        command += "cd .\\gcc\\bin\\\n";
        command += "mips64-gcc -G 0 -O1 -fno-reorder-blocks -std=gnu99 -mtune=vr4300 -march=vr4300 -mabi=32 -c -mips3 -mno-explicit-relocs -mno-memcpy -mno-check-zero-division -w \"" + p + "\"\n";
        command += "mips64-ld -o \"" + path.resolve(path.join(path.parse(p).dir, "temp" + ".elf")) + "\" \"temp.o\" -T z64-ovl.ld --emit-relocs\n"
        command += "cd ..\\..\\\n";
        command += "nOVL\\novl -vv -c -A " + addr + " -o \"" + path.resolve(path.join(path.parse(p).dir, path.parse(p).name + ".ovl")) + "\" \"" + path.resolve(path.join(path.parse(p).dir, path.parse(p).name + ".elf")) + "\"\n";
        fse.writeFileSync(path.resolve(path.join(process.cwd(), "build.bat")), command);
        child_process.execSync("\"" + path.resolve(path.join(process.cwd(), "build.bat")) + "\"");
        fse.copyFileSync(path.resolve(path.join(path.parse(p).dir, path.parse(p).name + ".ovl")), path.resolve(dest));
        process.chdir(original_dir);
        return path.resolve(path.join(path.parse(p).dir, path.parse(p).name + ".ovl"));
    }

    deleteRelevantActors() {
        this.actors_pointers_this_frame.length = 0;
        if (!this.core.helper.isLinkEnteringLoadingZone()) {
            for (let i = 0; i < 12 * 8; i += 8) {
                let count = this.ModLoader.emulator.rdramReadPtr32(
                    global.ModLoader.global_context_pointer,
                    this.actor_array_addr + i
                );
                let ptr = this.ModLoader.emulator.dereferencePointer(
                    global.ModLoader.global_context_pointer
                );
                if (count > 0) {
                    let pointer = this.ModLoader.emulator.dereferencePointer(
                        ptr + this.actor_array_addr + (i + 4)
                    );
                    this.actors_pointers_this_frame.push(pointer);
                    let next = this.ModLoader.emulator.dereferencePointer(
                        pointer + this.actor_next_offset
                    );
                    while (next > 0) {
                        this.actors_pointers_this_frame.push(next);
                        next = this.ModLoader.emulator.dereferencePointer(
                            next + this.actor_next_offset
                        );
                    }
                }
            }
        }
        for (let i = 0; i < this.actors_pointers_this_frame.length; i++) {
            let actor: IActor = this.core.actorManager.createIActorFromPointer(this.actors_pointers_this_frame[i]);
            if (this.relevant_ids.indexOf(actor.actorID) > -1) {
                let id = actor.actorID;
                let variable = actor.variable;
                this.last_pos.set(actor.actorID, JSON.parse(JSON.stringify(actor.position)));
                this.ModLoader.utils.setTimeoutFrames(() => {
                    this.ModLoader.emulator.rdramWrite16(0x600180, id);
                    this.ModLoader.emulator.rdramWrite16(0x60018E, variable);
                    this.core.commandBuffer.runCommand(Command.SPAWN_ACTOR, 0x80600180, (success: boolean, result: number) => {
                        if (success) {
                            console.log("Respawning actor!");
                            let pointer: number = result & 0x00ffffff;
                            let a: IActor = this.core.actorManager.createIActorFromPointer(pointer);
                            let pos: IPosition = this.last_pos.get(a.actorID)!;
                            a.position.x = pos.x;
                            a.position.y = pos.y;
                            a.position.z = pos.z;
                        }
                    });
                }, 20);
                console.log("Despawning actor for reload!");
                actor.destroy();
            }
        }
    }

    injectActor(file: string) {
        if (!this.core.helper.isTitleScreen() && this.core.helper.isSceneNumberValid()) {
            this.deleteRelevantActors();
        }
        let ovl = this.compileActor(path.resolve(file), path.resolve(path.join(path.parse(file).dir, path.parse(file).name + ".ovl")), path.resolve(path.join(path.parse(file).dir, path.parse(file).name + '.json')));
        let buf: Buffer = fse.readFileSync(ovl);
        actor_ovl_size.set(file, buf.byteLength);
        let payload: OverlayHotloadPayload = new OverlayHotloadPayload();
        this.relevant_ids.push(payload.parse(file, buf, this.ModLoader.emulator));
        this.ModLoader.utils.memoryCacheRefresh();
    }

}

module.exports = CatBinding;