var request = require('request');
var options = {
  'method': 'GET',
  'url': 'https://api.imgur.com/3/image/cL5nElu',
  'headers': {
    'Authorization': 'Client-ID 6a8a51f3d7933e1'
  },
  formData: {

  }
};
request(options, function (error, response) {
  if (error) throw new Error(error);
  console.log(response.body);
});
