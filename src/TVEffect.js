//////////////////////////////////////////////////////////////////////////////////////////
//          )                                                   (                       //
//       ( /(   (  (               )    (       (  (  (         )\ )    (  (            //
//       )\()) ))\ )(   (         (     )\ )    )\))( )\  (    (()/( (  )\))(  (        //
//      ((_)\ /((_|()\  )\ )      )\  '(()/(   ((_)()((_) )\ )  ((_)))\((_)()\ )\       //
//      | |(_|_))( ((_)_(_/(    _((_))  )(_))  _(()((_|_)_(_/(  _| |((_)(()((_|(_)      //
//      | '_ \ || | '_| ' \))  | '  \()| || |  \ V  V / | ' \)) _` / _ \ V  V (_-<      //
//      |_.__/\_,_|_| |_||_|   |_|_|_|  \_, |   \_/\_/|_|_||_|\__,_\___/\_/\_//__/      //
//                                 |__/                                                 //
//                       Copyright (c) 2021 Simon Schneegans                            //
//          Released under the GPLv3 or later. See LICENSE file for details.            //
//////////////////////////////////////////////////////////////////////////////////////////

'use strict';

const GObject = imports.gi.GObject;

const _ = imports.gettext.domain('burn-my-windows').gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me             = imports.misc.extensionUtils.getCurrentExtension();
const utils          = Me.imports.src.utils;

//////////////////////////////////////////////////////////////////////////////////////////
// This effect hides the actor by making it first transparent from top and bottom       //
// towards the middle and then hiding the resulting line from left and right towards    //
// the center.                                                                          //
//////////////////////////////////////////////////////////////////////////////////////////

// The shader class for this effect is registered further down in this file. When this
// effect is used for the first time, an instance of this shader class is created. Once
// the effect is finished, the shader will be stored in the freeShaders array and will
// then be reused if a new shader is requested. ShaderClass which will be used whenever
// this effect is used.
let ShaderClass = null;
let freeShaders = [];

// The effect class is completely static. It can be used to get some metadata (like the
// effect's name or supported GNOME Shell versions), to initialize the respective page of
// the settings dialog, as well as to create the actual shader for the effect.
var TVEffect = class TVEffect {

  // ---------------------------------------------------------------------------- metadata

  // The effect is available on all GNOME Shell versions supported by this extension.
  static getMinShellVersion() {
    return [3, 36];
  }

  // This will be called in various places where a unique identifier for this effect is
  // required. It should match the prefix of the settings keys which store whether the
  // effect is enabled currently (e.g. '*-close-effect'), and its animation time
  // (e.g. '*-animation-time').
  static getNick() {
    return 'tv';
  }

  // This will be shown in the sidebar of the preferences dialog as well as in the
  // drop-down menus where the user can choose the effect.
  static getLabel() {
    return _('TV Effect');
  }

  // -------------------------------------------------------------------- API for prefs.js

  // This is called by the preferences dialog. It loads the settings page for this effect,
  // binds all properties to the settings and appends the page to the main stack of the
  // preferences dialog.
  static getPreferences(dialog) {

    // Add the settings page to the builder.
    dialog.getBuilder().add_from_resource(`/ui/${utils.getGTKString()}/TVEffect.ui`);

    // Bind all properties.
    dialog.bindAdjustment('tv-animation-time');
    dialog.bindColorButton('tv-effect-color');

    // Finally, return the new settings page.
    return dialog.getBuilder().get_object('tv-prefs');
  }

  // ---------------------------------------------------------------- API for extension.js

  // This is called from extension.js whenever a window is opened or closed with this
  // effect. It returns an instance of the shader class, trying to reuse previously
  // created shaders.
  static getShader(actor, settings, forOpening) {
    let shader;

    if (freeShaders.length == 0) {
      shader = new ShaderClass();
    } else {
      shader = freeShaders.pop();
    }

    shader.setUniforms(actor, settings, forOpening);

    return shader;
  }

  // The tweakTransition() is called from extension.js to tweak a window's open / close
  // transitions - usually windows are faded in / out and scaled up / down by GNOME Shell.
  // The parameter 'forOpening' is set to true if this is called for a window-open
  // transition, for a window-close transition it is set to false. The modes can be set to
  // any value from here: https://gjs-docs.gnome.org/clutter8~8_api/clutter.animationmode.
  // The only required property is 'opacity', even if it transitions from 1.0 to 1.0. The
  // current value of the opacity transition is passed as uProgress to the shader.
  // Tweaking the actor's scale during the transition only works properly for GNOME 3.38+.

  // For this effect, windows are scaled down vertically.
  static tweakTransition(actor, settings, forOpening) {
    return {
      'opacity': {from: 255, to: 255, mode: 3},
      'scale-x': {from: 1.0, to: 1.0, mode: 3},
      'scale-y': {from: forOpening ? 0.5 : 1.0, to: forOpening ? 1.0 : 0.5, mode: 3}
    };
  }

  // This is called from extension.js if the extension is disabled. This should free all
  // static resources.
  static cleanUp() {
    freeShaders = [];
  }
}


//////////////////////////////////////////////////////////////////////////////////////////
// The shader class for this effect will only be registered in GNOME Shell's process    //
// (not in the preferences process). It's done this way as Clutter may not be installed //
// on the system and therefore the preferences would crash.                             //
//////////////////////////////////////////////////////////////////////////////////////////

if (utils.isInShellProcess()) {

  const {Clutter, Shell} = imports.gi;
  const shaderSnippets   = Me.imports.src.shaderSnippets;

  ShaderClass = GObject.registerClass({}, class ShaderClass extends Shell.GLSLEffect {
    // This is called when the effect is used for the first time. This can be used to
    // store all required uniform locations.
    _init() {
      super._init();

      this._uColor = this.get_uniform_location('uColor');
    }

    // This is called each time the effect is used. This can be used to retrieve the
    // configuration from the settings and update all uniforms accordingly.
    setUniforms(actor, settings, forOpening) {
      const c = Clutter.Color.from_string(settings.get_string('tv-effect-color'))[1];
      this.set_uniform_float(this._uColor, 3, [c.red / 255, c.green / 255, c.blue / 255]);
    }

    // This is called by extension.js when the shader is not used anymore. We will store
    // this instance of the shader so that it can be re-used in th future.
    free() {
      freeShaders.push(this);
    }

    // This is called by the constructor. This means, it's only called when the effect
    // is used for the first time.
    vfunc_build_pipeline() {
      const declarations = `
        // Inject some common shader snippets.
        ${shaderSnippets.standardUniforms()}

        uniform vec3 uColor;

        const float BLUR_WIDTH = 0.01; // Width of the gradients.
        const float TB_TIME    = 0.7;  // Relative time for the top/bottom animation.
        const float LR_TIME    = 0.4;  // Relative time for the left/right animation.
        const float LR_DELAY   = 0.6;  // Delay after which the left/right animation starts.
        const float FF_TIME    = 0.1;  // Relative time for the final fade to transparency.
      `;

      const code = `
        float progress = uForOpening ? 1.0-uProgress : uProgress;

        // All of these are in [0..1] during the different stages of the animation.
        // tb refers to the top-bottom animation.
        // lr refers to the left-right animation.
        // ff refers to the final fade animation.
        float tbProgress = smoothstep(0, 1, clamp(progress/TB_TIME, 0, 1));
        float lrProgress = smoothstep(0, 1, clamp((progress - LR_DELAY)/LR_TIME, 0, 1));
        float ffProgress = smoothstep(0, 1, clamp((progress - 1.0 + FF_TIME)/FF_TIME, 0, 1));

        // This is a top-center-bottom gradient in [0..1..0]
        float tb = cogl_tex_coord_in[0].t * 2;
        tb = tb < 1 ? tb : 2 - tb;
        
        // This is a left-center-right gradient in [0..1..0]
        float lr = cogl_tex_coord_in[0].s * 2;
        lr = lr < 1 ? lr : 2 - lr;
        
        // Combine the progress values with the gradients to create the alpha masks.
        float tbMask = 1 - smoothstep(0, 1, clamp((tbProgress - tb) / BLUR_WIDTH, 0, 1));
        float lrMask = 1 - smoothstep(0, 1, clamp((lrProgress - lr) / BLUR_WIDTH, 0, 1));
        float ffMask = 1 - smoothstep(0, 1, ffProgress);

        // Assemble the final alpha value.
        float mask = tbMask * lrMask * ffMask;

        cogl_color_out = texture2D(uTexture, cogl_tex_coord_in[0].st);
        
        // Shell.GLSLEffect uses straight alpha. So we have to convert from premultiplied.
        if (cogl_color_out.a > 0) {
          cogl_color_out.rgb /= cogl_color_out.a;
        }

        cogl_color_out.rgb = mix(cogl_color_out.rgb, uColor * cogl_color_out.a, smoothstep(0, 1, progress));
        cogl_color_out.a *= mask;

        // These are pretty useful for understanding how this works.
        // cogl_color_out = vec4(vec3(tbMask), 1);
        // cogl_color_out = vec4(vec3(lrMask), 1);
        // cogl_color_out = vec4(vec3(ffMask), 1);
        // cogl_color_out = vec4(vec3(mask), 1);
      `;

      this.add_glsl_snippet(Shell.SnippetHook.FRAGMENT, declarations, code, true);
    }
  });
}