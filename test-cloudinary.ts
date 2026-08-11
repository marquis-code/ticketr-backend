import { v2 as cloudinary } from 'cloudinary';
cloudinary.config({
  cloud_name: "marquis",
  api_key: "421665389631458",
  api_secret: "dpGA5rBo-WaKuWVPJ9yZiWxXxtA",
});

cloudinary.uploader.upload("/Users/marquis/tix-booking/public/public/favicon.ico", function(error, result) {
  console.log(result, error);
});
