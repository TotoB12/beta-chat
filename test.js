var myHeaders = new Headers();
myHeaders.append("Authorization", "Client-ID 6a8a51f3d7933e1");

var requestOptions = {
  method: 'GET',
  headers: myHeaders,
  redirect: 'follow'
};

// Fetching the metadata
fetch("https://api.imgur.com/3/image/cL5nElu", requestOptions)
  .then(response => response.json())
  .then(result => {
    // Extracting the image link
    var imageUrl = result.data.link;
    console.log('Image URL:', imageUrl);

    // Fetching the actual image data
    return fetch(imageUrl);
  })
  .then(imageResponse => imageResponse.blob())
  .then(imageBlob => {
    // Here you can process the imageBlob, for example, display it in an img tag
    // var imageUrl = URL.createObjectURL(imageBlob);
    // var imgTag = document.createElement('img');
    // imgTag.src = imageUrl;
    // document.body.appendChild(imgTag);
    console.log('Image Blob:', imageBlob);
  })
  .catch(error => console.log('error', error));
