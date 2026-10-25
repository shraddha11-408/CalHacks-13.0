// Real first-person photos from the glasses' point of view (public/media). Use these, not test frames.
export interface Photo {
  src: string
  alt: string
  place: 'Café' | 'Store' | 'Stockroom'
  task: string
}

export const PHOTOS: Record<string, Photo> = {
  cafeGrind: { src: '/media/cafe-grind.jpg', alt: 'Worker presses the grinder button while holding the portafilter under it', place: 'Café', task: 'Grind the coffee into the portafilter' },
  cafeTamp: { src: '/media/cafe-tamp.jpg', alt: 'Worker presses the tamper down on the coffee in the portafilter', place: 'Café', task: 'Tamp the coffee flat' },
  cafeEspresso: { src: '/media/cafe-espresso.jpg', alt: 'Espresso pours from the machine into a white cup', place: 'Café', task: 'Pull the espresso shot' },
  cafeLatte: { src: '/media/cafe-latte.jpg', alt: 'Worker pours steamed milk into a latte, making a heart', place: 'Café', task: 'Pour the milk' },
  retailCart: { src: '/media/retail-cart.jpg', alt: 'Worker pushes a cart with a box of shampoo down a store aisle', place: 'Store', task: 'Bring the box to the right aisle' },
  retailShelf: { src: '/media/retail-shelf.jpg', alt: 'Worker places shampoo bottles on the shelf from a box in the cart', place: 'Store', task: 'Stock the shelf, labels facing out' },
  backroomBox: { src: '/media/backroom-box.jpg', alt: 'Worker lifts a box of shampoo bottles onto a stockroom shelf', place: 'Stockroom', task: 'Put the box on the right shelf' },
}
