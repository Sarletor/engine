import { Component } from '../component.js';
import { ComponentSystem } from '../system.js';

import { AudioListenerComponent } from './component.js';
import { AudioListenerComponentData } from './data.js';

/* eslint-disable no-unused-vars */
import { Application } from '../../application.js';
import { SoundManager } from '../../../sound/manager.js';
/* eslint-enable no-unused-vars */


const _schema = ['enabled'];

/**
 * Component System for adding and removing {@link AudioComponent} objects to Entities.
 *
 * @augments ComponentSystem
 */
class AudioListenerComponentSystem extends ComponentSystem {
    /**
     * Create a new AudioListenerComponentSystem instance.
     *
     * @param {Application} app - The application managing this system.
     * @param {SoundManager} manager - A sound manager instance.
     */
    constructor(app, manager) {
        super(app);

        this.id = "audiolistener";

        this.ComponentType = AudioListenerComponent;
        this.DataType = AudioListenerComponentData;

        this.schema = _schema;

        this.manager = manager;
        this.current = null;

        this.app.systems.on('update', this.onUpdate, this);
    }

    initializeComponentData(component, data, properties) {
        properties = ['enabled'];

        super.initializeComponentData(component, data, properties);
    }

    onUpdate(dt) {
        if (this.current) {
            const position = this.current.getPosition();
            this.manager.listener.setPosition(position);

            const wtm = this.current.getWorldTransform();
            this.manager.listener.setOrientation(wtm);
        }
    }

    destroy() {
        super.destroy();

        this.app.systems.off('update', this.onUpdate, this);
    }
}

Component._buildAccessors(AudioListenerComponent.prototype, _schema);

export { AudioListenerComponentSystem };
