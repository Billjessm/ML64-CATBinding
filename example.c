#include <z64ovl/oot/u10.h>
#include <z64ovl/oot/helpers.h>

#define ACTOR_ID 0x5
#define OBJ_ID 0x1

typedef struct
{
    z64_actor_t actor;
} entity_t;

/* .text */
static void init(entity_t *en, z64_global_t *global)
{
    actor_set_scale(&en->actor, 0.01f);
    actor_set_height(&en->actor, 15.0f);
    //en->actor.text_id = 0x001A;
    en->actor.text_id = 0x001E;
}

static void play(entity_t *en, z64_global_t *global)
{
    external_func_8002F2F4(&en->actor, global);
    /* Checks if Link is busy */
    if (player_talk_state(AADDR(global, 0x20D8)) == 4)
    {
        /* Checks if the player responded to the textbox */
        if (player_responded_to_textbox(global) == 1)
        {
            int v = zh_player_textbox_selection(global);
        }
    }
}

static void dest(entity_t *en, z64_global_t *global)
{
}

static void draw(entity_t *en, z64_global_t *global)
{
}

/* .data */
const z64_actor_init_t init_vars = {
    .number = ACTOR_ID,
    .padding = 0x0,
    .type = 0x06,
    .room = 0xFF,
    .flags = 0x00000011,
    .object = OBJ_ID,
    .instance_size = sizeof(entity_t),
    .init = init,
    .dest = dest,
    .main = play,
    .draw = draw
};