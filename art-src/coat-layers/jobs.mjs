// Coat layers, step 2: what PixelLab paints on the reference horse (art-src/coat-layers/ref).
// One inpaint per variant; the mask says where it may paint. `mode` says how
// art-src/coat-layers/extract.ts reads the painting back into a layer:
//   white: texels turned white;  tick: single white hairs;  dark / light: how much darker or
//   lighter than the reference;  skin: pink skin;  hair: long hair (inside and outside the body).
const H = "a plain mid chestnut horse standing side view, detailed pixel art, same pose, same outline, same shading";
export const LAYER_JOBS = [
  // white patterns
  { id: "tobiano", mode: "white", mask: "horse", n: 3, text: `${H}, tobiano pinto: large smooth-edged pure white patches crossing over the back and down the flanks and the neck, white legs below the knees and hocks, the head stays chestnut` },
  { id: "tobiano-ink", mode: "white", mask: "horse", n: 2, text: `${H}, homozygous tobiano pinto: large pure white patches crossing the back, flanks and neck with small round chestnut ink spots inside the white, white legs, the head stays chestnut` },
  { id: "leopard", mode: "white", mask: "horse", n: 3, text: `${H}, leopard appaloosa: the whole body, neck and legs pure white covered with many round chestnut leopard spots of different sizes, the face mottled` },
  { id: "blanket", mode: "white", mask: "horse", n: 2, text: `${H}, blanket appaloosa: a pure white blanket over the hips and loins with round chestnut spots inside it, the front half chestnut` },
  { id: "fewspot", mode: "white", mask: "horse", n: 2, text: `${H}, few-spot appaloosa: almost entirely pure white body, neck, head and legs, with a few small chestnut patches left on the knees, hocks, flanks and around the eyes` },
  { id: "splash", mode: "white", mask: "horse", n: 2, text: `${H}, splash white overo: a very wide white blaze, white lower legs, a white belly splash with crisp smooth edges, the back stays chestnut` },
  { id: "splash2", mode: "white", mask: "horse", n: 1, text: `${H}, maximum splash white: a white bald face, the throat, chest, belly and all four legs pure white with crisp edges as if dipped in white paint, the back stays chestnut` },
  { id: "sabino1", mode: "white", mask: "horse", n: 2, text: `${H}, sabino: ragged roaned white on the lower legs running up in points, a white chin and a little ragged white flecking on the belly` },
  { id: "sabino2", mode: "white", mask: "horse", n: 2, text: `${H}, maximum sabino: mostly white body with ragged lacy edges, white legs and a white face, only the ears, the top of the head and a few patches on the chest and flank stay chestnut` },
  { id: "birdcatcher", mode: "white", mask: "body", n: 2, text: `${H}, birdcatcher spots: scattered small round pure white freckles of one or two pixels on the body, shoulder and hindquarters` },
  // face markings
  { id: "face-star", mode: "white", mask: "head", n: 3, text: `${H}, a small pure white star on the forehead between the eyes` },
  { id: "face-snip", mode: "white", mask: "head", n: 2, text: `${H}, a small pure white snip on the nose between the nostrils` },
  { id: "face-stripe", mode: "white", mask: "head", n: 2, text: `${H}, a narrow pure white stripe running down the front of the face from the forehead to the nose` },
  { id: "face-blaze", mode: "white", mask: "head", n: 3, text: `${H}, a wide pure white blaze running down the front of the face from the forehead over the nose` },
  { id: "face-bald", mode: "white", mask: "head", n: 2, text: `${H}, a bald face: the whole front of the face pure white from the forehead to the muzzle, around the eye stays chestnut` },
  // leg markings
  { id: "leg-coronet", mode: "white", mask: "legs", n: 2, text: `${H}, a thin pure white coronet band just above each hoof on all four legs` },
  { id: "leg-sock", mode: "white", mask: "legs", n: 2, text: `${H}, pure white socks on all four legs reaching just above the fetlock, with a slightly ragged top edge` },
  { id: "leg-stocking", mode: "white", mask: "legs", n: 2, text: `${H}, pure white stockings on all four legs reaching up to the knees and the hocks, with a slightly ragged top edge` },
  // ticking and dapples
  { id: "roan", mode: "tick", mask: "body", n: 2, text: `${H}, roan: many single white hairs evenly mixed through the body coat, the head, mane, tail and lower legs stay solid chestnut` },
  { id: "rabicano", mode: "tick", mask: "body", n: 2, text: `${H}, rabicano: white ticking hairs on the flanks and the belly near the hind legs, and a white skunk tail base with white hairs at the top of the tail` },
  { id: "varnish", mode: "tick", mask: "horse", n: 1, text: `${H}, varnish roan appaloosa: white hairs roaned over the body and the face, darker varnish marks stay on the bony points of the face, hips, knees and hocks` },
  { id: "greying", mode: "tick", mask: "horse", n: 1, text: `${H}, a young horse turning grey: white hairs mixed into the coat around the eyes, the face and the muzzle, a few on the neck and flanks` },
  { id: "dapple", mode: "light", mask: "body", n: 2, text: `${H}, dappled coat: many round lighter dapple rings evenly over the body, hindquarters and shoulders` },
  // dark layers
  { id: "dun", mode: "dark", mask: "horse", n: 2, text: `${H}, dun primitive markings only: a thin sharp dark brown dorsal stripe exactly along the spine from the mane to the tail, thin dark horizontal zebra bars on the lower legs; the rest of the coat colour stays exactly the same`, seeds: [9431] },
  { id: "sooty", mode: "dark", mask: "body", n: 2, text: `${H}, sooty: darker hairs dappled along the top line of the neck, back and croup, fading down the sides` },
  { id: "brindle", mode: "dark", mask: "horse", n: 3, text: `${H}, brindle: thin irregular dark brown vertical stripes over the body, neck and upper legs like a tiger's coat` },
  { id: "bendor", mode: "dark", mask: "body", n: 2, text: `${H}, bend or spots: a few irregular dark brown smudges and patches on the shoulder, flank and hindquarters` },
  // light layers and skin
  { id: "pangare", mode: "light", mask: "horse", n: 2, text: `${H}, pangare: pale mealy cream colour only around the muzzle and the eyes, under the belly, in the flanks and on the inside of the upper legs; the back, neck and shoulders stay exactly the same chestnut`, seeds: [null, 9471] },
  { id: "skin", mode: "skin", mask: "head", n: 1, text: `${H}, pink skin on the muzzle and the nose and around the eye` },
  // the feathered long-haired horse: a style reference only (the long hair is drawn in code,
  // packages/art-pipeline/src/longHair.ts; this job is not in the atlas)
  { reference: true, id: "feather", mode: "hair", mask: "hair", n: 2, text: `${H}, long hair breed: heavy feathering, long silky hair growing from the backs of the lower legs and falling over the hooves; a very long thick dark mane hanging down the neck; a very long full dark tail reaching the ground` },
];
