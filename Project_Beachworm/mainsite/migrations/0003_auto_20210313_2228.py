# Generated by Django 3.0.3 on 2021-03-13 22:28

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('mainsite', '0002_profile_refresh_token'),
    ]

    operations = [
        migrations.AlterField(
            model_name='playlist',
            name='id',
            field=models.IntegerField(primary_key=True, serialize=False),
        ),
    ]
